export const MOVIMENTACAO_DIRECAO = {
  ENTRADA: "ENTRADA",
  SAIDA: "SAIDA",
} as const;

export const MOVIMENTACAO_STATUS = {
  RASCUNHO: "RASCUNHO",
  PENDENTE_REVISAO: "PENDENTE_REVISAO",
  CONFIRMADO: "CONFIRMADO",
  EXPORTADO: "EXPORTADO",
} as const;

export const ARQUIVO_INGESTAO_STATUS = {
  PENDENTE: "PENDENTE",
  PROCESSANDO: "PROCESSANDO",
  CONCLUIDO: "CONCLUIDO",
  ERRO: "ERRO",
} as const;

export type MovimentacaoDirecao =
  (typeof MOVIMENTACAO_DIRECAO)[keyof typeof MOVIMENTACAO_DIRECAO];

export interface ParsedTransactionRow {
  dataMovimento: Date;
  valor: string;
  descricaoRaw: string;
  direcao: MovimentacaoDirecao;
  nrExtratoBancario: string | null;
}

/** Alias for ParsedTransactionRow used by pipeline helpers. */
export type IngestRow = ParsedTransactionRow;
