import type { ExtratoColumnMap } from "./extrato-column-map";

/** Validated E2E 2026-06-08 against Extrato Jan PIX (1).pdf (Caixa PIX, scanned). */
export const EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN: ExtratoColumnMap = {
  paginaReferencia: 1,
  inferirDirecaoDoValor: true,
  colunas: [
    { campo: "data", colunaIndex: 0, headerLabel: "Data" },
    { campo: "hora", colunaIndex: 1, headerLabel: "Hora" },
    { campo: "tipo_pix", colunaIndex: 2, headerLabel: "Tipo de PIX" },
    { campo: "situacao", colunaIndex: 3, headerLabel: "Situação" },
    {
      campo: "remetente_destinatario",
      colunaIndex: 4,
      headerLabel: "Remetente/Destinatário",
    },
    { campo: "valor", colunaIndex: 5, headerLabel: "Valor" },
  ],
};

export const EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN: ExtratoColumnMap = {
  paginaReferencia: 1,
  inferirDirecaoDoValor: true,
  colunas: [
    { campo: "data", colunaIndex: 0, headerLabel: "Data" },
    { campo: "documento", colunaIndex: 1, headerLabel: "Documento" },
    { campo: "historico", colunaIndex: 2, headerLabel: "Histórico" },
    { campo: "valor", colunaIndex: 3, headerLabel: "Valor" },
    { campo: "saldo", colunaIndex: 4, headerLabel: "Saldo" },
  ],
};

