/**
 * One-off analysis of "Documentos para teste" — run: pnpm exec tsx scripts/analyze-test-docs.ts
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  extractSpreadsheetHeaders,
  parseCadastroSpreadsheet,
  suggestCadastroColumnMap,
} from "../packages/core/src/cadastro/parse";
import type { CadastroColumnMap } from "../packages/core/src/cadastro/types";
import { parseExcel } from "../packages/core/src/ingest/excel";
import { extractPdfText } from "../packages/core/src/ingest/pdf-text";
import { extractDocumentCandidates } from "../packages/core/src/match/rules";

const BASE = path.join(
  process.cwd(),
  "Documentos para teste ",
);

async function main() {
  const xlsx = path.join(BASE, "pessoas bahia (1).xlsx");

  console.log("=== CADASTRO (pessoas bahia) ===");
  const xlsxBuf = await readFile(xlsx);
  try {
    const preview = await extractSpreadsheetHeaders(xlsxBuf, "pessoas bahia.xlsx");
    console.log("row1-as-headers:", preview.headers);
    console.log("suggested map:", preview.suggestedMap);
    await parseCadastroSpreadsheet(xlsxBuf, "pessoas bahia.xlsx");
    console.log("auto-parse: unexpected success");
  } catch (e) {
    console.log("auto-parse FAIL (expected):", e instanceof Error ? e.message : e);
  }

  console.log("\n--- workaround: mapear colunas pelos rótulos da linha 1 (perde 1ª pessoa) ---");

  const manualMapFromRow1: CadastroColumnMap = {
    nome: "iago Oliveira Motta",
    documento: "002.493.285-00",
    tipo: "Pessoa Física",
  };
  try {
    const partial = await parseCadastroSpreadsheet(
      xlsxBuf,
      "pessoas bahia.xlsx",
      manualMapFromRow1,
    );
    console.log(
      "map via row1 labels: ok",
      partial.ok.length,
      "erros",
      partial.erros.length,
      "(perde linha 1)",
    );
  } catch (e) {
    console.log("partial map FAIL:", e instanceof Error ? e.message : e);
  }

  console.log("\n=== EXCEL INGEST (same file) ===");
  try {
    const tx = await parseExcel(xlsx);
    console.log("tx rows:", tx.length);
  } catch (e) {
    console.log("EXCEL TX FAIL:", e instanceof Error ? e.message : e);
  }

  for (const pdfName of [
    "Extrato Jan PIX (1).pdf",
    "EXTRATO TOTAL JANEIRO (1) (1).pdf",
  ]) {
    console.log(`\n=== PDF: ${pdfName} ===`);
    const buf = await readFile(path.join(BASE, pdfName));
    try {
      const ex = await extractPdfText(buf);
      console.log(
        "pages:",
        ex.numpages,
        "chars:",
        ex.text.length,
        "hasEnoughText:",
        ex.hasEnoughText,
      );
      const lines = ex.text.split(/\n/).filter((l) => l.trim());
      console.log("line count:", lines.length);
      console.log("--- first 25 non-empty lines ---");
      for (const line of lines.slice(0, 25)) {
        console.log(line.trim().slice(0, 140));
      }
      const withDoc = lines.filter(
        (l) => extractDocumentCandidates(l).length > 0,
      );
      console.log("lines with CPF/CNPJ pattern:", withDoc.length);
      if (withDoc[0]) {
        console.log("sample doc line:", withDoc[0].slice(0, 140));
      }
    } catch (e) {
      console.log("PDF FAIL:", e instanceof Error ? e.message : e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
