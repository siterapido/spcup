import dotenv from "dotenv";
dotenv.config();

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../packages/db/src/schema";
import fs from "node:fs/promises";

const databaseUrl = process.env.DATABASE_URL!;

async function main() {
  const db = drizzle(neon(databaseUrl), { schema });
  let log = "";

  const sessoes = await db.select().from(schema.sessaoPrestacao);
  log += `Total sessions: ${sessoes.length}\n`;
  for (const s of sessoes) {
    log += `Session ID: ${s.id}\n`;
    log += `  UF: ${s.uf}, Exercicio: ${s.exercicio}, Referencia: ${s.mesReferencia}\n`;
    log += `  Status: ${s.status}, Consolidar: ${s.consolidarExtratos}\n`;
    
    const arquivos = await db.select().from(schema.arquivoIngestao).where(eq(schema.arquivoIngestao.sessaoPrestacaoId, s.id));
    log += `  Files (${arquivos.length}):\n`;
    for (const a of arquivos) {
      log += `    - Name: ${a.nomeArquivo}, Status: ${a.status}\n`;
      if (a.erroMensagem) {
        log += `      Error: ${a.erroMensagem.split('\n')[0]}\n`;
      }
    }
    log += `--------------------------------------------------\n`;
  }

  await fs.writeFile("scripts/debug-output.txt", log, "utf8");
  console.log("Wrote all sessions metadata to scripts/debug-output.txt");
}

import { eq } from "drizzle-orm";

main().catch(console.error);
