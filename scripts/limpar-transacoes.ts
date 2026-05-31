/**
 * Script to clean all transaction, session, and ingestion records.
 * Run: pnpm exec tsx scripts/limpar-transacoes.ts
 */
import { getDb } from "@spc-up/db";
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import * as fs from "node:fs";

// Load environment variables
config();
if (fs.existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

async function main() {
  const db = getDb();
  console.log("Conectando ao banco de dados...");

  console.log("Limpando transações, sessões e dados de processamento/consolidação...");

  await db.execute(sql`
    TRUNCATE TABLE 
      consolidacao_hipotese, 
      consolidacao_linha, 
      consolidacao_evento, 
      match_evidencia, 
      movimentacao_spca, 
      doacao_financeira_link, 
      movimentacao, 
      ingestao_linha_pendente, 
      ingestao_pagina, 
      arquivo_ingestao, 
      sessao_prestacao 
    CASCADE;
  `);

  console.log("Banco de dados limpo com sucesso!");
}

main().catch((error) => {
  console.error("Erro ao limpar transações:", error);
  process.exit(1);
});
