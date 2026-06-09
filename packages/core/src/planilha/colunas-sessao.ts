import { ExtratoModeloId, extratoColumnMapForModelo } from "../ingest/extrato-modelo";
import { CamposExtracao } from "../ingest/campos-extracao";

export const PLANILHA_COLUNA_ORDER = [
  "data",
  "documento",
  "valor",
  "direcao",
  "historico",
  "remetente_destinatario",
  "hora",
  "tipo_pix",
  "situacao",
  "saldo",
] as const;

export function colunasFromModelos(modelos: ExtratoModeloId[]): string[] {
  const camposSet = new Set<string>();
  for (const modelo of modelos) {
    const map = extratoColumnMapForModelo(modelo);
    if (map) {
      for (const col of map.colunas) {
        if (col.campo) {
          camposSet.add(col.campo);
        }
      }
    }
  }
  return Array.from(camposSet).sort((a, b) => {
    const idxA = PLANILHA_COLUNA_ORDER.indexOf(a as any);
    const idxB = PLANILHA_COLUNA_ORDER.indexOf(b as any);
    if (idxA !== -1 && idxB !== -1) {
      return idxA - idxB;
    }
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}

export function colunasFromCamposUnion(camposList: CamposExtracao[]): string[] {
  const keysSet = new Set<string>();
  for (const campos of camposList) {
    if (campos) {
      for (const [key, value] of Object.entries(campos)) {
        if (value != null && value !== "") {
          keysSet.add(key);
        }
      }
    }
  }
  return Array.from(keysSet).sort((a, b) => {
    const idxA = PLANILHA_COLUNA_ORDER.indexOf(a as any);
    const idxB = PLANILHA_COLUNA_ORDER.indexOf(b as any);
    if (idxA !== -1 && idxB !== -1) {
      return idxA - idxB;
    }
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });
}
