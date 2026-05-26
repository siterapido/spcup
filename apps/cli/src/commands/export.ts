import { canExport, exportBundle, XsdValidationError } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function runExport(opts: {
  uf: string;
  exercicio: string;
  out: string;
}): Promise<void> {
  const exercicio = Number.parseInt(opts.exercicio, 10);
  if (Number.isNaN(exercicio)) {
    throw new Error("--exercicio must be a number");
  }

  const outDir = path.resolve(opts.out);
  await mkdir(outDir, { recursive: true });

  const db = getDb();

  if (!(await canExport(db, opts.uf, exercicio))) {
    console.error(
      "Exportação bloqueada: existem pendências ou bloqueio_export para este UF/exercício.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const paths = await exportBundle(db, opts.uf, exercicio, outDir);
    for (const target of paths) {
      if (path.basename(target) === "validacao.json") {
        continue;
      }
      console.log(`→ ${target}`);
    }
    console.log("Exportação concluída.");
  } catch (error) {
    if (error instanceof XsdValidationError) {
      console.error("XML inválido contra XSD SPCA; exportação não publicada.");
      for (const [filename, errors] of Object.entries(error.errorsByFile)) {
        if (errors.length === 0) {
          continue;
        }
        console.error(`  ${filename}:`);
        for (const message of errors) {
          console.error(`    - ${message}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
