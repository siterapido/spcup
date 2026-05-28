import "./pdf-node-setup";
import { createCanvas } from "@napi-rs/canvas";

export type RenderPdfPageOptions = {
  scale?: number;
};

/** Render a 1-based PDF page to PNG bytes (server-side). */
export async function renderPdfPageToPng(
  pdfBuffer: Buffer,
  page1Based: number,
  options?: RenderPdfPageOptions,
): Promise<Buffer> {
  const scale = options?.scale ?? 2;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  if (page1Based < 1 || page1Based > doc.numPages) {
    throw new Error(`Página inválida: ${page1Based} (total ${doc.numPages})`);
  }
  const page = await doc.getPage(page1Based);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({
    canvasContext: context as never,
    viewport,
  }).promise;
  return canvas.toBuffer("image/png");
}
