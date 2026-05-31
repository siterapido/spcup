import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../packages/db/src/schema";
import { arquivoIngestao } from "../packages/db/src/schema";
import { desc } from "drizzle-orm";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const db = drizzle(neon(databaseUrl), { schema });
  const records = await db
    .select()
    .from(arquivoIngestao)
    .orderBy(desc(arquivoIngestao.createdAt))
    .limit(10);

  console.log("Recent files in arquivo_ingestao:");
  records.forEach(r => {
    console.log(`\nID: ${r.id}`);
    console.log(`Name: ${r.nomeArquivo}`);
    console.log(`Status: ${r.status}`);
    console.log(`Error Msg: ${r.erroMensagem}`);
    console.log(`Storage: ${r.caminhoStorage}`);
    console.log(`Created At: ${r.createdAt}`);
  });
}

main().catch(console.error);
