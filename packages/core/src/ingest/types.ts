export const TIPO_PRESTADOR = {
  ESTADUAL: "ESTADUAL",
  MUNICIPAL: "MUNICIPAL",
} as const;

export type TipoPrestador = (typeof TIPO_PRESTADOR)[keyof typeof TIPO_PRESTADOR];

export interface PrestadorContext {
  cnpjPrestador: string;
  tipoPrestador: TipoPrestador;
  sessaoPrestacaoId?: string;
  diretorioMunicipalId?: string;
}

export const MOVIMENTACAO_DIRECAO = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAIDA",
} as const;

export const MOVIMENTACAO_STATUS = {
  RASCUNHO: "RASCUNHO",
  PENDENTE_REVISAO: "PENDENTE_REVISAO",
  CONFIRMADO: "CONFIRMADO",
  EXPORTADO: "EXPORTADO",
  REJEITADO: "REJEITADO",
} as const;

export const ARQUIVO_INGESTAO_STATUS = {
  PENDENTE: "PENDENTE",
  PROCESSANDO: "PROCESSANDO",
  CONCLUIDO: "CONCLUIDO",
  ERRO: "ERRO",
} as const;

export type MovimentacaoDirecao =
  (typeof MOVIMENTACAO_DIRECAO)[keyof typeof MOVIMENTACAO_DIRECAO];

import type { OrigemExtracaoV1 } from "../provenance/types";

export interface ParsedTransactionRow {
  dataMovimento: Date;
  valor: string;
  descricaoRaw: string;
  direcao: MovimentacaoDirecao;
  nrExtratoBancario: string | null;
  /** Código Cred/Dev do extrato bancário, quando extraído. */
  credDev: string | null;
  origemExtracao?: OrigemExtracaoV1 | null;
  /** 0–100 from dual-model pipeline; defaults to 0 in persist when omitted. */
  confiancaGlobal?: number;
  remetenteDestinatario?: string | null;
}

/** Alias for ParsedTransactionRow used by pipeline helpers. */
export type IngestRow = ParsedTransactionRow;
