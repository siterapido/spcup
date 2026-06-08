import type { BboxNorm, OrigemExtracaoV1 } from "./types";

export function clampBbox(bbox: BboxNorm): BboxNorm | undefined {
  const { x, y, w, h } = bbox;
  if ([x, y, w, h].some((n) => !Number.isFinite(n) || n < 0 || n > 1)) {
    return undefined;
  }
  if (w <= 0 || h <= 0) {
    return undefined;
  }
  if (x + w > 1.001 || y + h > 1.001) {
    return undefined;
  }
  return { x, y, w, h };
}

export function validateOrigemExtracao(
  raw: Omit<OrigemExtracaoV1, "versao" | "bbox" | "campos"> & {
    bbox?: BboxNorm;
    campos?: OrigemExtracaoV1["campos"];
  },
  pageCount: number,
): OrigemExtracaoV1 | null {
  if (raw.pagina < 1 || raw.pagina > pageCount) {
    return null;
  }
  if (raw.indiceLinha < 1) {
    return null;
  }
  const bbox = raw.bbox ? clampBbox(raw.bbox) : undefined;
  return {
    versao: 1,
    arquivoIngestaoId: raw.arquivoIngestaoId,
    nomeArquivo: raw.nomeArquivo,
    pagina: raw.pagina,
    indiceLinha: raw.indiceLinha,
    bbox,
    campos: raw.campos,
    cpfContraparte: raw.cpfContraparte ?? null,
    cnpjContraparte: raw.cnpjContraparte ?? null,
    horaContraparte: raw.horaContraparte ?? null,
  };
}
