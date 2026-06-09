import dotenv from "dotenv";
dotenv.config();

import { getDb } from "../packages/db/src/client";
import * as schema from "../packages/db/src/schema";
import { eq } from "drizzle-orm";
import { processSessaoWithNotebookLM } from "../packages/core/src/prestacao/process-sessao-notebooklm";
import { ARQUIVO_INGESTAO_STATUS } from "../packages/core/src/ingest/types";

const sessaoId = "92298be8-1b68-49fc-a961-b8bf8280585f";

async function main() {
  const db = getDb();

  console.log("Resetting file statuses to PENDENTE...");
  await db
    .update(schema.arquivoIngestao)
    .set({
      status: ARQUIVO_INGESTAO_STATUS.PENDENTE,
      erroMensagem: null,
    })
    .where(eq(schema.arquivoIngestao.sessaoPrestacaoId, sessaoId));

  console.log("Running processSessaoWithNotebookLM...");
  const result = await processSessaoWithNotebookLM(db, sessaoId);
  console.log("Processing finished!");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
