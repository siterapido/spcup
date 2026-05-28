/**
 * pdf-parse pulls in pdfjs-dist, which expects browser globals in Node.
 * @napi-rs/canvas is resolved by pdfjs when installed; this module ensures it loads first.
 */
function ensurePdfNodeGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix !== "undefined") {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const canvas = require("@napi-rs/canvas") as Record<string, unknown>;
    if (canvas.DOMMatrix && !g.DOMMatrix) {
      g.DOMMatrix = canvas.DOMMatrix;
    }
    if (canvas.ImageData && !g.ImageData) {
      g.ImageData = canvas.ImageData;
    }
    if (canvas.Path2D && !g.Path2D) {
      g.Path2D = canvas.Path2D;
    }
  } catch {
    // pdf-parse may still work on some runtimes; missing canvas surfaces as PDF_INVALIDO later.
  }
}

ensurePdfNodeGlobals();
