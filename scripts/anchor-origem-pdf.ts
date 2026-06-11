/**
 * Reancora bbox no text layer para movimentações de um arquivo ou sessão.
 *
 * Uso:
 *   pnpm exec tsx scripts/anchor-origem-pdf.ts --arquivo <arquivoIngestaoId>
 *   pnpm exec tsx scripts/anchor-origem-pdf.ts --sessao <sessaoPrestacaoId>
 *   pnpm exec tsx scripts/anchor-origem-pdf.ts --arquivo <id> --force
 */
import dotenv from "dotenv";

dotenv.config();

import { eq } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { anexarBboxOrigensPorArquivo } from "../packages/core/src/provenance/anexar-bbox-origens";
import { detectExtratoModeloFromFilename } from "../packages/core/src/ingest/extrato-modelo";
import { readArquivoIngestaoBuffer } from "../packages/core/src/storage/read-arquivo";
import * as schema from "../packages/db/src/schema";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function anchorArquivo(
  db: ReturnType<typeof drizzle>,
  arquivoId: string,
  force: boolean,
) {
  const rows = await db
    .select()
    .from(schema.arquivoIngestao)
    .where(eq(schema.arquivoIngestao.id, arquivoId))
    .limit(1);
  const arq = rows[0];
  if (!arq) {
    throw new Error(`Arquivo não encontrado: ${arquivoId}`);
  }
  if (!/\.pdf$/i.test(arq.nomeArquivo)) {
    console.log(`Ignorado (não é PDF): ${arq.nomeArquivo}`);
    return;
  }

  const buffer = await readArquivoIngestaoBuffer(arq.caminhoStorage);
  const modeloId = detectExtratoModeloFromFilename(arq.nomeArquivo);
  const result = await anexarBboxOrigensPorArquivo(db as never, arquivoId, buffer, {
    nomeArquivo: arq.nomeArquivo,
    modeloId,
    force,
  });

  console.log(
    `[${arq.nomeArquivo}] total=${result.total} ancoradas=${result.ancoradas} falhas=${result.falhas} ignoradas=${result.ignoradas}`,
  );
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL ausente");
  }

  const arquivoId = arg("--arquivo");
  const sessaoId = arg("--sessao");
  const force = process.argv.includes("--force");

  if (!arquivoId && !sessaoId) {
    console.error(
      "Informe --arquivo <id> ou --sessao <id> (opcional: --force)",
    );
    process.exit(1);
  }

  const db = drizzle(neon(databaseUrl), { schema });

  if (arquivoId) {
    await anchorArquivo(db, arquivoId, force);
    return;
  }

  const arquivos = await db
    .select()
    .from(schema.arquivoIngestao)
    .where(eq(schema.arquivoIngestao.sessaoPrestacaoId, sessaoId!));

  for (const arq of arquivos) {
    if (!/\.pdf$/i.test(arq.nomeArquivo)) {
      continue;
    }
    await anchorArquivo(db, arq.id, force);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
