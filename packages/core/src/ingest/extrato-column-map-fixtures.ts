import type { ExtratoColumnMap } from "./extrato-column-map";

/** Validated E2E 2026-06-08 against Extrato Jan PIX (1).pdf (Caixa PIX, scanned). */
export const EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN: ExtratoColumnMap = {
  paginaReferencia: 1,
  inferirDirecaoDoValor: true,
  colunas: [
    { campo: "data", colunaIndex: 0, headerLabel: "Data" },
    { campo: "valor", colunaIndex: 1, headerLabel: "Valor" },
    { campo: "documento", colunaIndex: 2, headerLabel: "Documento" },
    {
      campo: "remetente_destinatario",
      colunaIndex: 3,
      headerLabel: "Remetente/Destinatário",
    },
    { campo: "historico", colunaIndex: 4, headerLabel: "Histórico" },
  ],
};

/** Layout PIX 6 colunas: Data, Hora, Tipo PIX, Situação, Remetente/Destinatário, Valor. */
export const EXTRATO_COLUMN_MAP_PIX_6COL: ExtratoColumnMap = {
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
