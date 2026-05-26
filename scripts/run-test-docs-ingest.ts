/**
 * Smoke test: Documentos para teste + OpenRouter. Run: pnpm exec tsx scripts/run-test-docs-ingest.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

async function loadEnvFile(): Promise<void> {
  try {
    const raw = await readFile(path.join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq);
      if (process.env[key] == null) {
        process.env[key] = trimmed.slice(eq + 1);
      }
    }
  } catch {
    // .env optional
  }
}

import { parseCadastroSpreadsheet } from "../packages/core/src/cadastro/parse";
import {
  extractTransactionsFromPdfFile,
  resolvePdfTimeoutMs,
} from "../packages/core/src/ai/openrouter";
import { rowsFromExtratoTransactions } from "../packages/core/src/ingest/pdf";

const BASE = path.join(process.cwd(), "Documentos para teste ");

async function main() {
  await loadEnvFile();

  const xlsx = await readFile(path.join(BASE, "pessoas bahia (1).xlsx"));
  const cad = await parseCadastroSpreadsheet(xlsx, "pessoas bahia.xlsx", {
    nome: "nome",
    documento: "documento",
    tipo: "tipo",
  });
  console.log("CADASTRO ok", cad.ok.length, "erros", cad.erros.length);

  const pdfName = process.argv[2] ?? "Extrato Jan PIX (1).pdf";
  const pdf = await readFile(path.join(BASE, pdfName));
  console.log(
    "PDF",
    pdfName,
    "bytes",
    pdf.length,
    "model",
    process.env.OPENROUTER_PDF_MODEL,
    "timeout_ms",
    resolvePdfTimeoutMs(),
  );

  const t0 = Date.now();
  const ext = await extractTransactionsFromPdfFile(pdf, { filename: pdfName });
  const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(ext);
  console.log(
    "extrato ms",
    Date.now() - t0,
    "transacoes",
    ext.transacoes.length,
    "rows",
    rows.length,
    "sem_doc",
    linhasIgnoradasSemDoc,
  );
  if (rows[0]) {
    console.log("sample", rows[0].dataMovimento.toISOString().slice(0, 10), rows[0].valor, rows[0].descricaoRaw.slice(0, 100));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
