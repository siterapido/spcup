import { getConfiancaLimiarBaixa } from "../consolidacao/thresholds";
import type { PlanilhaLinha, PlanilhaResumo } from "./types";

const LIMIAR_BAIXA = () => getConfiancaLimiarBaixa();

function isSemRemetenteDestinatario(remetenteDestinatario: string | null): boolean {
  return !remetenteDestinatario || remetenteDestinatario.length < 3;
}

/** Extração duvidosa ainda bloqueia export/revisão? */
export function isExtracaoBloqueando(input: {
  extracaoDuvidosa: boolean;
  extracaoConfirmada: boolean;
  pessoa: PlanilhaLinha["pessoa"];
}): boolean {
  if (!input.extracaoDuvidosa) return false;
  if (input.extracaoConfirmada) return false;
  // Vínculo manual de PF/PJ aceita valor/data da linha (spec §7.3)
  if (input.pessoa) return false;
  return true;
}

export function deriveLinhaStatus(input: {
  eventoStatus?: string;
  origemCount: number;
  pessoa: PlanilhaLinha["pessoa"];
  confianca: number;
  extracaoDuvidosa: boolean;
  extracaoConfirmada: boolean;
}): PlanilhaLinha["status"] {
  if (
    isExtracaoBloqueando({
      extracaoDuvidosa: input.extracaoDuvidosa,
      extracaoConfirmada: input.extracaoConfirmada,
      pessoa: input.pessoa,
    })
  ) {
    return "extracao_duvidosa";
  }
  if (
    input.eventoStatus === "PENDENTE" &&
    input.origemCount >= 2
  ) {
    return "merge_pendente";
  }
  const draft: PlanilhaLinha = {
    id: "",
    fonte: "movimentacao",
    dataMovimento: "",
    valor: "",
    direcao: "",
    descricao: "",
    descricaoRaw: "",
    nrExtratoBancario: null,
    confianca: input.confianca,
    status: "pendente",
    pessoa: input.pessoa,
    remetenteDestinatario: null,
    origens: [],
    extracaoDuvidosa: input.extracaoDuvidosa,
    extracaoConfirmada: input.extracaoConfirmada,
  };
  return isLinhaPronta(draft) ? "pronta" : "pendente";
}

export function isLinhaPronta(linha: PlanilhaLinha): boolean {
  if (linha.status === "merge_pendente") return false;
  if (
    isExtracaoBloqueando({
      extracaoDuvidosa: linha.extracaoDuvidosa,
      extracaoConfirmada: linha.extracaoConfirmada,
      pessoa: linha.pessoa,
    })
  ) {
    return false;
  }
  if (!linha.pessoa) return false;
  if (linha.confianca < LIMIAR_BAIXA()) return false;
  return true;
}

export function buildResumo(
  linhas: PlanilhaLinha[],
  cadastroAlerta: boolean,
): PlanilhaResumo {
  const limiar = LIMIAR_BAIXA();
  let prontas = 0;
  let semPessoa = 0;
  let semRemetenteDestinatario = 0;
  let baixaConfianca = 0;
  let mergePendente = 0;
  let extracaoDuvidosa = 0;
  let docSemCadastro = 0;
  let nomeDiverge = 0;

  for (const l of linhas) {
    if (isLinhaPronta(l)) prontas++;
    if (!l.pessoa) semPessoa++;
    if (isSemRemetenteDestinatario(l.remetenteDestinatario)) semRemetenteDestinatario++;
    if (l.confianca < limiar) baixaConfianca++;
    if (l.status === "merge_pendente") mergePendente++;
    if (l.status === "extracao_duvidosa") extracaoDuvidosa++;
    if (l.cadastroLinkTier === "BAIXA" && !l.pessoa) docSemCadastro++;
    if (l.comparacaoNome === "difere" && l.pessoa) nomeDiverge++;
  }

  return {
    total: linhas.length,
    prontas,
    semPessoa,
    semRemetenteDestinatario,
    baixaConfianca,
    mergePendente,
    extracaoDuvidosa,
    cadastroAlerta,
    exportavel: linhas.length > 0 && prontas === linhas.length,
    docSemCadastro,
    nomeDiverge,
  };
}
