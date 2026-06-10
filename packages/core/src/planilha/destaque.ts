import type { PlanilhaLinha, PlanilhaOrigem } from "./types";

/** Retorna a origem primária da linha (`origens[0]`), ou null se vazio. */
export function getOrigemDestaque(linha: PlanilhaLinha): PlanilhaOrigem | null {
  if (!linha.origens || linha.origens.length === 0) return null;
  return linha.origens[0];
}
