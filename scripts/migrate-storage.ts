/**
 * Migrate local upload files to Vercel Blob.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... DATABASE_URL=... pnpm migrate-storage
 */
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { basename } from "node:path";

import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { getDb } from "@spc-up/db";
import { arquivoIngestao } from "@spc-up/db/schema";

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required");
  }

  const db = getDb();
  const rows = await db.select().from(arquivoIngestao);

  let migrated = 0;
  let missing = 0;
  let failed = 0;

  for (const row of rows) {
    const localPath = row.caminhoStorage;
    try {
      await access(localPath, constants.R_OK);
    } catch {
      console.warn(`[missing] ${row.id} — ${localPath}`);
      missing += 1;
      continue;
    }

    try {
      const body = await readFile(localPath);
      const blob = await put(`ingest/${row.uf}/${row.exercicio}/${basename(localPath)}`, body, {
        access: "public",
        addRandomSuffix: false,
      });

      await db
        .update(arquivoIngestao)
        .set({ caminhoStorage: blob.url, updatedAt: new Date() })
        .where(eq(arquivoIngestao.id, row.id));

      migrated += 1;
      console.log(`[ok] ${row.nomeArquivo} → ${blob.url}`);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[error] ${row.id}: ${message}`);
    }
  }

  console.log(
    `Done. migrated=${migrated} missing=${missing} failed=${failed} total=${rows.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
