/**
 * pdf-parse pulls in pdfjs-dist, which expects browser globals in Node.
 * @napi-rs/canvas is resolved by pdfjs when installed; this module ensures it loads first.
 */
function ensurePdfNodeGlobals(): void {
  if (typeof globalThis.DOMMatrix !== "undefined") {
    return;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const canvas = require("@napi-rs/canvas") as {
      DOMMatrix?: typeof DOMMatrix;
      ImageData?: typeof ImageData;
      Path2D?: typeof Path2D;
    };
    if (canvas.DOMMatrix && !globalThis.DOMMatrix) {
      globalThis.DOMMatrix = canvas.DOMMatrix as typeof globalThis.DOMMatrix;
    }
    if (canvas.ImageData && !globalThis.ImageData) {
      globalThis.ImageData = canvas.ImageData as typeof globalThis.ImageData;
    }
    if (canvas.Path2D && !globalThis.Path2D) {
      globalThis.Path2D = canvas.Path2D as typeof globalThis.Path2D;
    }
  } catch {
    // pdf-parse may still work on some runtimes; missing canvas surfaces as PDF_INVALIDO later.
  }
}

ensurePdfNodeGlobals();
