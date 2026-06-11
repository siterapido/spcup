import "../ingest/pdf-node-setup";

import type { PdfPaginaTexto, PdfTextItem } from "./types";

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

async function openPdfDocument(pdfBuffer: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdfjs-dist worker entry lacks types
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as Record<string, unknown>).pdfjsWorker = workerModule;
  return pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise;
}

async function textItemsFromPage(
  page: { getViewport: (p: { scale: number }) => { width: number; height: number }; getTextContent: () => Promise<{ items: unknown[] }> },
): Promise<PdfTextItem[]> {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const itens: PdfTextItem[] = [];

  for (const raw of textContent.items) {
    if (
      typeof raw !== "object" ||
      raw == null ||
      !("str" in raw) ||
      typeof (raw as { str: unknown }).str !== "string"
    ) {
      continue;
    }
    const item = raw as {
      str: string;
      transform: number[];
      width: number;
      height: number;
    };
    if (item.str.length === 0) {
      continue;
    }
    const tx = item.transform;
    const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || item.height;
    const x = (tx[4] ?? 0) / viewport.width;
    const y = (viewport.height - (tx[5] ?? 0) - fontHeight) / viewport.height;
    const width = item.width / viewport.width;
    const height = fontHeight / viewport.height;

    itens.push({
      str: item.str,
      x: clamp01(x),
      y: clamp01(y),
      width: clamp01(width),
      height: clamp01(height),
    });
  }

  return itens;
}

export type ExtractPdfTextLayerResult = {
  paginas: PdfPaginaTexto[];
  pageCount: number;
};

/** Extract normalized text items per page (server-side pdf.js). */
export async function extractPdfTextLayer(
  pdfBuffer: Buffer,
  pageNumbers?: number[],
): Promise<ExtractPdfTextLayerResult> {
  const doc = await openPdfDocument(pdfBuffer);
  const pageCount = doc.numPages;

  const toExtract =
    pageNumbers != null && pageNumbers.length > 0
      ? [...new Set(pageNumbers.filter((p) => p >= 1 && p <= pageCount))].sort(
          (a, b) => a - b,
        )
      : Array.from({ length: pageCount }, (_, i) => i + 1);

  const paginas: PdfPaginaTexto[] = [];
  for (const pagina of toExtract) {
    const page = await doc.getPage(pagina);
    const itens = await textItemsFromPage(page);
    paginas.push({ pagina, itens });
  }

  return { paginas, pageCount };
}
