import type { ExtratoColumnMap } from "./extrato-column-map";
import {
  EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN,
  EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN,
} from "./extrato-column-map-fixtures";

export type ExtratoModeloId = "caixa_pix" | "caixa_total" | "outro";

export const EXTRATO_MODELO_LABELS: Record<ExtratoModeloId, string> = {
  caixa_pix: "Caixa — Extrato PIX",
  caixa_total: "Caixa — Extrato Total",
  outro: "Outro (mapear manualmente)",
};

export function detectExtratoModeloFromFilename(nome: string): ExtratoModeloId {
  const lowercase = nome.toLowerCase();
  if (lowercase.includes("pix")) {
    return "caixa_pix";
  }
  if (lowercase.includes("total")) {
    return "caixa_total";
  }
  return "outro";
}

export function extratoColumnMapForModelo(id: ExtratoModeloId): ExtratoColumnMap | undefined {
  if (id === "caixa_pix") {
    return EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN;
  }
  if (id === "caixa_total") {
    return EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN;
  }
  return undefined;
}
