import type { BboxNorm } from "../provenance/types";

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPaginaTexto = {
  pagina: number;
  itens: PdfTextItem[];
};

export type LocalizarLinhaPdfInput = {
  paginas: PdfPaginaTexto[];
  dataMovimento: string;
  valor: string;
  descricaoRaw: string;
  remetenteDestinatario?: string | null;
  documento?: string | null;
  hora?: string | null;
  /** Extrato PIX Caixa: data costuma ficar fora da linha da transação */
  relaxarDataNaLinha?: boolean;
};

export type LocalizarLinhaPdfResult =
  | { encontrado: true; pagina: number; bbox: BboxNorm; confianca: "estimada" }
  | { encontrado: false; motivo: string };

export type LinhaPdfAgrupada = {
  texto: string;
  bbox: BboxNorm;
  itens: PdfTextItem[];
};
