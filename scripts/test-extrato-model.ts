import { readFile } from "node:fs/promises";
import path from "node:path";

import { extractTransactionsFromPdfFile } from "../packages/core/src/ai/openrouter";
import { extractPdfText } from "../packages/core/src/ingest/pdf-text";

const MODEL = process.argv[2] ?? process.env.OPENROUTER_PDF_MODEL;
const PDF_DIR = path.join(process.cwd(), "Documentos para teste ");
const PDFS = [
  "Extrato Jan PIX (1).pdf",
  "EXTRATO TOTAL JANEIRO (1) (1).pdf",
];

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(1);
  }
  if (!MODEL) {
    console.error("Usage: tsx scripts/test-extrato-model.ts <openrouter-model>");
    process.exit(1);
  }

  process.env.OPENROUTER_CACHE = "0";
  console.log("model:", MODEL);

  for (const name of PDFS) {
    const filePath = path.join(PDF_DIR, name);
    const buffer = await readFile(filePath);
    const { text, hasEnoughText, numpages } = await extractPdfText(buffer);
    const t0 = Date.now();

    try {
      const result = await extractTransactionsFromPdfFile(buffer, {
        model: MODEL,
        filename: name,
      });
      const ms = Date.now() - t0;
      console.log("\n---", name, "---");
      console.log({
        pages: numpages,
        textLen: text.length,
        hasEnoughText,
        transacoes: result.transacoes.length,
        duracaoMs: ms,
      });
      if (result.transacoes[0]) {
        console.log("sample:", JSON.stringify(result.transacoes[0]));
      }
    } catch (error) {
      console.error("\n---", name, "FAIL ---");
      console.error(error instanceof Error ? error.message : error);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
