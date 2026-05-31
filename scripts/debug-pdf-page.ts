/**
 * Debug PDF page extraction without DB status checks.
 * Usage: pnpm exec tsx scripts/debug-pdf-page.ts "<blob-or-path>" [pagina]
 */
import { readFile } from "node:fs/promises";

import { extractTransactionsFromPdfFile } from "../packages/core/src/ai/openrouter";
import { classifyIngestError } from "../packages/core/src/ingest/errors";
import { extractPdfText } from "../packages/core/src/ingest/pdf-text";
import { extractSinglePageBuffer, getPdfPageCount } from "../packages/core/src/ingest/pdf-split";
import { readArquivoIngestaoBuffer } from "../packages/core/src/storage/read-arquivo";

async function loadBuffer(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    return readArquivoIngestaoBuffer(source);
  }
  return readFile(source);
}

async function main() {
  const source = process.argv[2];
  const pagina = Number.parseInt(process.argv[3] ?? "1", 10);
  if (!source) {
    console.error('Usage: tsx scripts/debug-pdf-page.ts "<url-or-path>" [pagina]');
    process.exit(1);
  }

  console.log("OPENROUTER_API_KEY:", Boolean(process.env.OPENROUTER_API_KEY?.trim()));
  console.log("OPENROUTER_PDF_MODEL:", process.env.OPENROUTER_PDF_MODEL ?? "(default)");

  const buffer = await loadBuffer(source);
  console.log("bytes:", buffer.length);

  const totalPaginas = await getPdfPageCount(buffer);
  console.log("pages:", totalPaginas);

  const pageBuffer = await extractSinglePageBuffer(buffer, pagina);
  console.log("page buffer bytes:", pageBuffer.length);

  try {
    const { text, hasEnoughText, numpages } = await extractPdfText(pageBuffer);
    console.log("pdf-parse pages:", numpages, "textLen:", text.length, "hasEnoughText:", hasEnoughText);
  } catch (error) {
    const detail = classifyIngestError(error);
    console.error("pdf-parse FAIL:", detail.codigo, detail.causaTecnica);
    process.exit(1);
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.log("Skip OpenRouter (no API key)");
    return;
  }

  try {
    const t0 = Date.now();
    const ext = await extractTransactionsFromPdfFile(pageBuffer, {
      filename: "debug.pdf",
    });
    console.log("OpenRouter OK ms:", Date.now() - t0, "transacoes:", ext.transacoes.length);
  } catch (error) {
    const detail = classifyIngestError(error);
    console.error("OpenRouter FAIL:", detail.codigo, detail.mensagem);
    console.error("causaTecnica:", detail.causaTecnica);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
