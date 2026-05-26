/**
 * Compare row counts between old and new databases.
 *
 * Usage:
 *   OLD_DATABASE_URL=postgresql://... DATABASE_URL=postgresql://... pnpm verify-counts
 */
import { neon } from "@neondatabase/serverless";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "@spc-up/db/schema";
import { arquivoIngestao, diretorioEstadual, movimentacao } from "@spc-up/db/schema";

const TABLES = [
  { name: "diretorio_estadual", table: diretorioEstadual },
  { name: "arquivo_ingestao", table: arquivoIngestao },
  { name: "movimentacao", table: movimentacao },
] as const;

async function countTable(
  url: string,
  table: (typeof TABLES)[number]["table"],
): Promise<number> {
  const db = drizzle(neon(url), { schema });
  const [row] = await db.select({ n: count() }).from(table);
  return Number(row?.n ?? 0);
}

async function main(): Promise<void> {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.DATABASE_URL;

  if (!oldUrl || !newUrl) {
    throw new Error("OLD_DATABASE_URL and DATABASE_URL are required");
  }

  let ok = true;
  console.log("table\told\tnew\tmatch");

  for (const { name, table } of TABLES) {
    const oldCount = await countTable(oldUrl, table);
    const newCount = await countTable(newUrl, table);
    const match = oldCount === newCount;
    if (!match) {
      ok = false;
    }
    console.log(`${name}\t${oldCount}\t${newCount}\t${match ? "yes" : "NO"}`);
  }

  if (!ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
