/**
 * Browser-only pdf.js loader (legacy ESM build — avoids Turbopack chunk issues with build/pdf.mjs).
 */

export type PdfJsLegacy = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsPromise: Promise<PdfJsLegacy> | null = null;

export function loadPdfJs(): Promise<PdfJsLegacy> {
  if (pdfjsPromise) {
    return pdfjsPromise;
  }

  pdfjsPromise = (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Served from apps/web/public — copied from pdfjs-dist@4.10.38 legacy build
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  })();

  return pdfjsPromise;
}
