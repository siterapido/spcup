import { CONSOLIDACAO_EVENTO_STATUS } from "@spc-up/db";
import { getConfiancaLimiarBaixa } from "../consolidacao/thresholds";
import type { PlanilhaLinha, PlanilhaResumo } from "./types";

const LIMIAR_BAIXA = () => getConfiancaLimiarBaixa();

export function deriveLinhaStatus(input: {
  eventoStatus?: string;
  origemCount: number;
  pessoa: PlanilhaLinha["pessoa"];
  confianca: number;
  extracaoDuvidosa: boolean;
}): PlanilhaLinha["status"] {
  if (input.extracaoDuvidosa) return "extracao_duvidosa";
  if (
    input.eventoStatus === CONSOLIDACAO_EVENTO_STATUS.PENDENTE &&
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
    confianca: input.confianca,
    status: "pendente",
    pessoa: input.pessoa,
    origens: [],
    extracaoDuvidosa: false,
  };
  return isLinhaPronta(draft) ? "pronta" : "pendente";
}

export function isLinhaPronta(linha: PlanilhaLinha): boolean {
  if (linha.extracaoDuvidosa === true) return false;
  if (linha.status === "merge_pendente" || linha.status === "extracao_duvidosa") {
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
  let baixaConfianca = 0;
  let mergePendente = 0;
  let extracaoDuvidosa = 0;

  for (const l of linhas) {
    if (isLinhaPronta(l)) prontas++;
    if (!l.pessoa) semPessoa++;
    if (l.confianca < limiar) baixaConfianca++;
    if (l.status === "merge_pendente") mergePendente++;
    if (l.status === "extracao_duvidosa") extracaoDuvidosa++;
  }

  return {
    total: linhas.length,
    prontas,
    semPessoa,
    baixaConfianca,
    mergePendente,
    extracaoDuvidosa,
    cadastroAlerta,
    exportavel: linhas.length > 0 && prontas === linhas.length,
  };
}
