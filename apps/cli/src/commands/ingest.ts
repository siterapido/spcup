import { getDiretorio, ingestFile, resolveIngestPaths } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import path from "node:path";

export async function runIngest(opts: {
  uf: string;
  exercicio: string;
  path: string;
}): Promise<void> {
  console.error(
    "[deprecated] Use: spcup prestacao upload --sessao <uuid> --path ./lote/",
  );

  const exercicio = Number.parseInt(opts.exercicio, 10);
  if (Number.isNaN(exercicio)) {
    throw new Error("--exercicio must be a number");
  }

  const db = getDb();
  const diretorio = await getDiretorio(db, opts.uf);
  if (diretorio == null) {
    console.error(`Diretório estadual não cadastrado para UF=${opts.uf.toUpperCase()}.`);
    process.exitCode = 1;
    return;
  }

  const sources = await resolveIngestPaths(opts.path);
  let total = 0;

  for (const source of sources) {
    const name = path.basename(source);
    try {
      const count = await ingestFile(db, {
        diretorioId: diretorio.id,
        uf: opts.uf,
        exercicio,
        source,
      });
      total += count;
      console.log(`${name}: ${count} movimentação(ões)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${name}: ERRO — ${message}`);
    }
  }

  console.log(
    `Ingestão concluída: ${total} movimentação(ões) em ${sources.length} arquivo(s).`,
  );
}
