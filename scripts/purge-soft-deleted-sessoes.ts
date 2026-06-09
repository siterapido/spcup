/**
 * Remove prestações soft-deleted e dados vinculados do banco.
 * Run: pnpm exec tsx scripts/purge-soft-deleted-sessoes.ts
 */
import { purgeSoftDeletedSessoes } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { config } from "dotenv";
import * as fs from "node:fs";

config();
if (fs.existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

async function main() {
  const db = getDb();
  const purged = await purgeSoftDeletedSessoes(db);
  console.log(`Prestações soft-deleted removidas do banco: ${purged}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
