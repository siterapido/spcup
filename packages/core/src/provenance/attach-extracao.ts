import type { OrigemExtracaoV1 } from "./types";
import { validateOrigemExtracao } from "./validate";

export type AttachExtracaoCtx = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  batchPagina: number;
  pageCount: number;
};

/** Build persisted PDF anchor; batch page wins over model page for single-page vision batches. */
export function origemFromExtratoItem(
  item: Record<string, unknown>,
  ctx: AttachExtracaoCtx,
): OrigemExtracaoV1 | null {
  const indiceRaw = item.indice_linha ?? item.indiceLinha;
  const indiceLinha = Number(indiceRaw);
  const bboxRaw = item.bbox;
  const bbox =
    bboxRaw != null &&
    typeof bboxRaw === "object" &&
    !Array.isArray(bboxRaw)
      ? (bboxRaw as { x: number; y: number; w: number; h: number })
      : undefined;

  return validateOrigemExtracao(
    {
      arquivoIngestaoId: ctx.arquivoIngestaoId,
      nomeArquivo: ctx.nomeArquivo,
      pagina: ctx.batchPagina,
      indiceLinha: Number.isFinite(indiceLinha) && indiceLinha >= 1 ? indiceLinha : 1,
      bbox,
    },
    ctx.pageCount,
  );
}
