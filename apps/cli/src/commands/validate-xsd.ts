import { validateXml, type SchemaName } from "@spc-up/spca";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

const SCHEMAS = new Set<SchemaName>(["origem", "aplicacao", "doacao"]);

export async function runValidateXsd(opts: {
  file: string;
  schema: string;
}): Promise<void> {
  if (!SCHEMAS.has(opts.schema as SchemaName)) {
    throw new Error("--schema must be origem, aplicacao or doacao");
  }

  try {
    await access(opts.file, constants.F_OK);
  } catch {
    console.error(`Arquivo não encontrado: ${opts.file}`);
    process.exitCode = 1;
    return;
  }

  const errors = await validateXml(opts.file, opts.schema as SchemaName);
  if (errors.length > 0) {
    console.error(`Inválido (${errors.length} erro(s)):`);
    for (const message of errors) {
      console.error(`  - ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`OK — ${opts.file} válido para schema '${opts.schema}'.`);
}
