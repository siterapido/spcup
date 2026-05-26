import { generatePendenciasCsv } from "@spc-up/core";
import { getDb } from "@spc-up/db";

export async function runPendencias(opts: {
  uf: string;
  exercicio: string;
  output: string;
}): Promise<void> {
  const exercicio = Number.parseInt(opts.exercicio, 10);
  if (Number.isNaN(exercicio)) {
    throw new Error("--exercicio must be a number");
  }

  const db = getDb();
  const count = await generatePendenciasCsv(db, opts.uf, exercicio, opts.output);
  console.log(`Pendências: ${count} linha(s) → ${opts.output}`);
}
