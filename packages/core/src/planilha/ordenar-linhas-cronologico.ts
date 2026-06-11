import type { PlanilhaLinha } from "./types";

function horaFromLinha(linha: PlanilhaLinha): string | null {
  const fromCampos = linha.camposExtracao?.hora;
  if (fromCampos) return fromCampos;
  for (const origem of linha.origens) {
    const h = origem.camposExtracao?.hora ?? origem.origemExtracao?.horaContraparte;
    if (h) return h;
  }
  return null;
}

function horaToSeconds(hora: string): number | null {
  const parts = hora.trim().split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  const [h = 0, m = 0, s = 0] = parts;
  return h * 3600 + m * 60 + s;
}

function indiceLinhaFromLinha(linha: PlanilhaLinha): number {
  let min = Number.MAX_SAFE_INTEGER;
  for (const origem of linha.origens) {
    const idx = origem.indiceLinha ?? origem.origemExtracao?.indiceLinha;
    if (idx != null && idx < min) min = idx;
  }
  return min;
}

function documentoFromLinha(linha: PlanilhaLinha): string {
  return (
    linha.nrExtratoBancario ??
    linha.camposExtracao?.documento ??
    linha.origens[0]?.nrExtratoBancario ??
    ""
  );
}

/** Compare planilha rows in ascending chronological order (date → time → doc → id). */
export function compareLinhasPlanilhaCronologicamente(
  a: PlanilhaLinha,
  b: PlanilhaLinha,
): number {
  const byDate = a.dataMovimento.localeCompare(b.dataMovimento);
  if (byDate !== 0) return byDate;

  const ha = horaFromLinha(a);
  const hb = horaFromLinha(b);
  if (ha && hb) {
    const sa = horaToSeconds(ha);
    const sb = horaToSeconds(hb);
    if (sa != null && sb != null && sa !== sb) return sa - sb;
  } else if (ha && !hb) {
    return -1;
  } else if (!ha && hb) {
    return 1;
  }

  const ia = indiceLinhaFromLinha(a);
  const ib = indiceLinhaFromLinha(b);
  if (ia !== ib) return ia - ib;

  const byDoc = documentoFromLinha(a).localeCompare(documentoFromLinha(b));
  if (byDoc !== 0) return byDoc;

  return a.id.localeCompare(b.id);
}

export function ordenarLinhasPlanilhaCronologicamente(
  linhas: PlanilhaLinha[],
): PlanilhaLinha[] {
  return [...linhas].sort(compareLinhasPlanilhaCronologicamente);
}
