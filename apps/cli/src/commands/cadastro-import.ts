import { importCadastroBatch, parseCadastroSpreadsheet } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { printJson } from "../lib/format-output";

export async function runCadastroImport(opts: {
  uf: string;
  exercicio: string;
  file: string;
  dryRun?: boolean;
  json?: boolean;
}): Promise<void> {
  const exercicio = Number.parseInt(opts.exercicio, 10);
  if (Number.isNaN(exercicio)) {
    throw new Error("--exercicio must be a number");
  }

  const buffer = await readFile(opts.file);
  const parsed = await parseCadastroSpreadsheet(
    buffer,
    path.basename(opts.file),
  );

  if (opts.dryRun) {
    const summary = {
      linhas_ok: parsed.ok.length,
      erros: parsed.erros,
    };
    if (opts.json) printJson(summary);
    else {
      console.log(
        `Dry-run: ${parsed.ok.length} linha(s) válida(s), ${parsed.erros.length} erro(s).`,
      );
    }
    return;
  }

  const db = getDb();
  const result = await importCadastroBatch(
    db,
    parsed.ok,
    opts.uf.toUpperCase(),
    exercicio,
  );
  const payload = { ...result, erros: [...parsed.erros, ...result.erros] };

  if (opts.json) printJson(payload);
  else {
    console.log(
      `Importação: ${result.inseridos} inseridos, ${result.atualizados} atualizados, ${result.conflitos} conflitos.`,
    );
    for (const e of payload.erros) {
      console.error(`  ERRO linha ${e.linha}: ${e.mensagem}`);
    }
  }
}
