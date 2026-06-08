import {
  isNomeContraparteVazio,
  resolveNomeEffective,
} from "../match/nome-contraparte";
import type { OrigemExtracaoV1 } from "../provenance/types";
import { cleanDescricao } from "./descricao";
import { deriveLinhaStatus } from "./status";
import type { PlanilhaLinha, PlanilhaOrigem, PlanilhaPessoa } from "./types";

const EXTRACAO_DUVIDOSA_CONFIANCA = 0.4;

export type ConsolidacaoEventoLinhaInput = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  pessoaFisicaId?: string | null;
  pessoaJuridicaId?: string | null;
  nomeContraparte?: string | null;
  extracaoConfirmada?: boolean;
  pessoa: {
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
  } | null;
  linhas: Array<{
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nrExtratoBancario: string | null;
    nomeArquivo: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
  }>;
};

export function buildNomeFields(
  persistido: string | null | undefined,
  origens: PlanilhaOrigem[],
): Pick<PlanilhaLinha, "nome" | "nomeContraparte" | "nomeDerivado"> {
  const origensInput = origens.map((o) => ({
    descricaoRaw: o.descricaoRaw,
    papel: o.papel,
  }));
  const nome = resolveNomeEffective(persistido, origensInput);
  const derivado = !persistido || isNomeContraparteVazio(persistido);
  return {
    nome,
    nomeContraparte: persistido ?? null,
    nomeDerivado: derivado && !isNomeContraparteVazio(nome),
  };
}

function mapPessoaFromConsolidacao(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaPessoa | null {
  if (!evento.pessoa) return null;
  const id = evento.pessoaFisicaId ?? evento.pessoaJuridicaId;
  if (!id) return null;
  return { id, ...evento.pessoa };
}

function origensFromLinhas(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
): PlanilhaOrigem[] {
  return linhas.map((l) => ({
    movimentacaoId: l.movimentacaoId,
    arquivoIngestaoId: l.origemExtracao?.arquivoIngestaoId,
    nomeArquivo: l.nomeArquivo,
    pagina: l.origemExtracao?.pagina,
    descricaoRaw: l.descricaoRaw,
    nrExtratoBancario: l.nrExtratoBancario,
    papel: l.papel,
    origemExtracao: l.origemExtracao,
    indiceLinha: l.origemExtracao?.indiceLinha,
    bbox: l.origemExtracao?.bbox,
  }));
}

function descricaoFromLinhas(linhas: ConsolidacaoEventoLinhaInput["linhas"]): string {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return cleanDescricao(primary?.descricaoRaw ?? "");
}

function descricaoRawFromLinhas(linhas: ConsolidacaoEventoLinhaInput["linhas"]): string {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return primary?.descricaoRaw ?? "";
}

function nrExtratoBancarioFromLinhas(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
): string | null {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return primary?.nrExtratoBancario ?? null;
}

function isExtracaoDuvidosaConsolidacao(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
  confianca: number,
): boolean {
  return linhas.some((l) => !l.origemExtracao && confianca < EXTRACAO_DUVIDOSA_CONFIANCA);
}

export function mapConsolidacaoEventoToLinha(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaLinha {
  const origens = origensFromLinhas(evento.linhas);
  const pessoa = mapPessoaFromConsolidacao(evento);
  const extracaoConfirmada = evento.extracaoConfirmada === true;
  const extracaoDuvidosaRaw = isExtracaoDuvidosaConsolidacao(
    evento.linhas,
    evento.confianca,
  );
  const extracaoDuvidosa = extracaoDuvidosaRaw && !extracaoConfirmada;
  const nomeFields = buildNomeFields(evento.nomeContraparte, origens);

  return {
    id: evento.id,
    fonte: "consolidacao",
    dataMovimento: evento.dataMovimento,
    valor: evento.valor,
    direcao: evento.direcao,
    descricao: descricaoFromLinhas(evento.linhas),
    descricaoRaw: descricaoRawFromLinhas(evento.linhas),
    nrExtratoBancario: nrExtratoBancarioFromLinhas(evento.linhas),
    confianca: evento.confianca,
    status: deriveLinhaStatus({
      eventoStatus: evento.status,
      origemCount: origens.length,
      pessoa,
      confianca: evento.confianca,
      extracaoDuvidosa,
      extracaoConfirmada,
    }),
    pessoa,
    ...nomeFields,
    origens,
    eventoStatus: evento.status,
    extracaoDuvidosa,
    extracaoConfirmada,
  };
}
