/**
 * Replay page processing for a stored arquivo_ingestao row.
 * Usage: pnpm exec tsx scripts/replay-ingest-page.ts <arquivoId> [pagina]
 */
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import { classifyIngestError, processarPaginaPdfExtrato } from "../packages/core/src";
import * as schema from "../packages/db/src/schema";
import { arquivoIngestao } from "../packages/db/src/schema";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://neondb_owner:npg_TQELIg5lU2Vd@ep-fragrant-wildflower-ace7uaug-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require";

async function main() {
  const arquivoId = process.argv[2];
  const pagina = Number.parseInt(process.argv[3] ?? "1", 10);
  if (!arquivoId) {
    console.error("Usage: tsx scripts/replay-ingest-page.ts <arquivoId> [pagina]");
    process.exit(1);
  }

  const db = drizzle(neon(databaseUrl), { schema });
  const rows = await db
    .select()
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.id, arquivoId))
    .limit(1);
  const arquivo = rows[0];
  if (!arquivo) {
    console.error("Arquivo not found:", arquivoId);
    process.exit(1);
  }

  console.log("Arquivo:", arquivo.nomeArquivo, "status:", arquivo.status);
  console.log("Storage:", arquivo.caminhoStorage.slice(0, 80), "...");
  console.log("OPENROUTER_API_KEY set:", Boolean(process.env.OPENROUTER_API_KEY?.trim()));

  try {
    const result = await processarPaginaPdfExtrato(db, arquivoId, pagina, {
      cnpjPrestador: "00000000000000",
      tipoPrestador: "ESTADUAL",
      sessaoPrestacaoId: arquivo.sessaoPrestacaoId ?? undefined,
    });
    console.log("OK:", result);
  } catch (error) {
    const detail = classifyIngestError(error);
    console.error("FAIL codigo:", detail.codigo);
    console.error("mensagem:", detail.mensagem);
    console.error("causaTecnica:", detail.causaTecnica);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
