/**
 * Script to wipe domain data (sessions, movements, people).
 * Run: ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts
 */
import { getDb } from "@spc-up/db";
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import * as fs from "node:fs";

config();
if (fs.existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

async function main() {
  if (process.env.ALLOW_DOMAIN_WIPE !== "1") {
    console.error(
      "Abortado: defina ALLOW_DOMAIN_WIPE=1 para executar o wipe de domínio.",
    );
    process.exit(1);
  }

  const db = getDb();
  console.log("Conectando ao banco de dados...");

  console.log("Limpando domínio (sessões, movimentações, pessoas)...");

  await db.execute(sql`
    TRUNCATE TABLE
      cadastro_conflito,
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
      sessao_prestacao,
      conta_bancaria,
      pessoa_fisica,
      pessoa_juridica
    CASCADE;
  `);

  console.log("Domínio limpo com sucesso!");
}

main().catch((error) => {
  console.error("Erro ao limpar domínio:", error);
  process.exit(1);
});
