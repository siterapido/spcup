import { listNotebooks, getOrCreateNotebook, uploadFileToNotebook, queryNotebook } from "../packages/core/src/ai/notebooklm";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function main() {
  console.log("=== Starting NotebookLM Integration Test ===");

  try {
    console.log("Step 1: Listing notebooks...");
    const notebooks = await listNotebooks();
    console.log(`Success! Found ${notebooks.length} notebooks:`);
    for (const nb of notebooks) {
      console.log(` - ID: ${nb.id} | Title: ${nb.title}`);
    }

    const testUf = "TST";
    const testEx = 2026;
    const testTitle = `SPC-UP ${testUf} ${testEx}`;
    console.log(`\nStep 2: Getting or creating notebook for '${testTitle}'...`);
    const notebookId = await getOrCreateNotebook(testUf, testEx);
    console.log(`Success! Notebook ID: ${notebookId}`);

    console.log("\nStep 3: Creating a temporary test document to upload...");
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, "extrato_teste_notebooklm.txt");
    const testContent = `
EXTRATO DE CONTA CORRENTE - PARTIDO DO TESTE
PERIODO: 01/01/2026 A 31/01/2026

LANÇAMENTOS:
10/01/2026 DEPOSITO IDENTIFICADO MARIA CANDIDATA CPF: 123.456.789-01 VALOR: 1.500,00 C (CREDITO)
15/01/2026 PAGAMENTO ELETROPAULO VALOR: 250,00 D (DEBITO)
    `.trim();

    await fs.writeFile(tempFilePath, testContent, "utf8");
    console.log(`Temporary file written to: ${tempFilePath}`);

    try {
      console.log("\nStep 4: Uploading test document to the notebook...");
      const sourceId = await uploadFileToNotebook(notebookId, tempFilePath);
      console.log(`Success! Source uploaded. ID/Result: ${sourceId}`);

      console.log("\nStep 5: Querying notebook with extraction prompt...");
      const queryPrompt = `Você concilia transações bancárias de prestação de contas partidária no Brasil. 
Analise todos os extratos bancários e arquivos de cadastro (PF/PJ) contidos neste notebook.
Extraia todas as transações (lançamentos) de débito e crédito presentes nos extratos bancários.
Determine também a Fonte de Recurso (01, 09, etc) e a Natureza de Recurso (D, O, P, etc) para a transação.

Retorne APENAS um array JSON válido (sem explicações ou marcações markdown como \`\`\`json). O array deve conter objetos com o seguinte schema exato:
[
  {
    "data": "YYYY-MM-DD",
    "valor": 1250.50,
    "direcao": "CREDITO" | "DEBITO",
    "descricao": "Descrição original da transação",
    "documento_candidato": "CPF ou CNPJ do candidato correspondente (somente números, ou null)",
    "nome_candidato": "Nome ou Razão Social do candidato correspondente (ou null)",
    "fonte_recurso": "Código da fonte de recurso, ex: '01', '09', '12' (ou null)",
    "natureza_recurso": "Código da natureza de recurso, ex: 'D', 'O', 'P' (ou null)"
  }
]`;

      const response = await queryNotebook(notebookId, queryPrompt);
      console.log("Success! Received response from NotebookLM:");
      console.log("-----------------------------------------");
      console.log(response.answer);
      console.log("-----------------------------------------");

      // Verify JSON parsing
      let clean = response.answer.trim();
      if (clean.startsWith("```")) {
        const firstNewline = clean.indexOf("\n");
        if (firstNewline !== -1) {
          clean = clean.slice(firstNewline + 1);
        }
        if (clean.endsWith("```")) {
          clean = clean.slice(0, -3);
        }
        clean = clean.trim();
      }

      try {
        const parsed = JSON.parse(clean);
        console.log(`Successfully parsed JSON array with ${parsed.length} transaction(s).`);
        console.log("Test passed!");
      } catch (parseErr) {
        console.error("Warning: Response is not valid JSON.");
        console.error(parseErr);
      }

    } finally {
      // Clean up temporary local file
      await fs.unlink(tempFilePath).catch(() => {});
    }

  } catch (error: any) {
    console.error("\n=== Test Failed ===");
    console.error(error.message || error);
    console.log("\nPossible solutions:");
    console.log("1. Check if the default profile is logged in. Run: nlm login");
    console.log("2. Set NOTEBOOKLM_PROFILE environment variable if using a non-default profile.");
  }
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  process.exit(1);
});
