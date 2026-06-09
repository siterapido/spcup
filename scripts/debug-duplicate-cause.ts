import dotenv from "dotenv";
dotenv.config();

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

async function runNlm(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("nlm", args);
  return stdout;
}

const basePrompt = `Você concilia transações bancárias.`;

async function main() {
  console.log("Creating temporary notebook...");
  const createOutput = await runNlm(["notebook", "create", "SPC-UP Temp Diagnostic", "--json"]);
  const parsedNotebook = JSON.parse(createOutput);
  const notebookId = parsedNotebook.notebook_id || parsedNotebook.id || parsedNotebook.notebook?.id;
  if (!notebookId) {
    throw new Error(`Failed to create notebook: ${createOutput}`);
  }
  console.log(`Created notebook: ${notebookId}`);

  try {
    // Upload a small test file so query doesn't fail with NOT_FOUND
    const tempFilePath = path.join(os.tmpdir(), "dummy_source.txt");
    await fs.writeFile(tempFilePath, "Este é um extrato de teste para conciliação bancária.", "utf8");
    console.log("Uploading dummy source...");
    await runNlm(["source", "add", notebookId, "--file", tempFilePath, "--wait"]);
    await fs.unlink(tempFilePath).catch(() => {});

    const testPrompt = async (name: string, suffix: string) => {
      const fullPrompt = basePrompt + "\n\n---\n" + suffix + "\n---";
      try {
        await runNlm(["query", "notebook", notebookId, fullPrompt, "--json"]);
        console.log(`[+] ${name}: SUCCESS`);
      } catch (err: any) {
        console.log(`[-] ${name}: FAILED`);
        if (err.stdout) console.log(`    Stdout: ${err.stdout.trim()}`);
      }
    };

    // Test 1: Full duplicate with ranges
    console.log("\nTesting prompt suffix variants:");
    await testPrompt("Test 1 (Full original mapping with duplicate index 4 and ranges)", 
      `coluna 0 = data (rótulo "Data") [faixa horizontal 0%-16% da página]
coluna 1 = hora [faixa horizontal 16%-25% da página]
coluna 2 = historico [faixa horizontal 26%-38% da página]
coluna 3 = situacao [faixa horizontal 38%-50% da página]
coluna 4 = valor [faixa horizontal 81%-100% da página]
coluna 4 = remetente_destinatario [faixa horizontal 50%-81% da página]
Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor.`
    );

    // Test 2: Duplicate index 4 but WITHOUT ranges
    await testPrompt("Test 2 (Duplicate index 4 without ranges)", 
      `coluna 0 = data (rótulo "Data")
coluna 1 = hora
coluna 2 = historico
coluna 3 = situacao
coluna 4 = valor
coluna 4 = remetente_destinatario
Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor.`
    );

    // Test 3: No duplicates (valor mapped to index 5)
    await testPrompt("Test 3 (No duplicate column indices, valor mapped to 5)", 
      `coluna 0 = data (rótulo "Data") [faixa horizontal 0%-16% da página]
coluna 1 = hora [faixa horizontal 16%-25% da página]
coluna 2 = historico [faixa horizontal 26%-38% da página]
coluna 3 = situacao [faixa horizontal 38%-50% da página]
coluna 4 = remetente_destinatario [faixa horizontal 50%-81% da página]
coluna 5 = valor [faixa horizontal 81%-100% da página]
Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor.`
    );

  } finally {
    console.log("\nDeleting temporary notebook...");
    await runNlm(["notebook", "delete", notebookId, "--confirm"]).catch(console.error);
  }
}

main().catch(console.error);
