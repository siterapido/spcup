import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const SCHEMA_FILES = {
  origem: "origemRecurso.xsd",
  aplicacao: "aplicacaoRecurso.xsd",
  doacao: "doacaoFinanceira.xsd",
} as const;

export type SchemaName = keyof typeof SCHEMA_FILES;

export function schemaPath(schemaName: SchemaName): string {
  return join(SCHEMA_DIR, SCHEMA_FILES[schemaName]);
}

function shouldSkipWhenXmllintMissing(): boolean {
  return (
    process.env.SPC_SKIP_XSD_VALIDATION === "1" ||
    process.env.CI === "true" ||
    process.env.CI === "1"
  );
}

async function isXmllintAvailable(): Promise<boolean> {
  try {
    await execFileAsync("xmllint", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an XML file against the named SPCA schema.
 *
 * Requires `xmllint` (libxml2) locally. When xmllint is unavailable and
 * `CI` or `SPC_SKIP_XSD_VALIDATION=1` is set, returns an empty list (skip).
 */
export async function validateXml(
  filePath: string,
  schemaName: SchemaName,
): Promise<string[]> {
  const xsdPath = schemaPath(schemaName);

  try {
    await access(xsdPath, constants.F_OK);
  } catch {
    throw new Error(`Schema not found: ${xsdPath}`);
  }

  const xmllintAvailable = await isXmllintAvailable();
  if (!xmllintAvailable) {
    if (shouldSkipWhenXmllintMissing()) {
      return [];
    }
    throw new Error(
      "xmllint is required for XSD validation (install libxml2). " +
        "Set SPC_SKIP_XSD_VALIDATION=1 to skip when xmllint is unavailable.",
    );
  }

  try {
    await execFileAsync("xmllint", ["--noout", "--schema", xsdPath, filePath]);
    return [];
  } catch (error: unknown) {
    const err = error as { stderr?: string | Buffer; stdout?: string | Buffer; message?: string };
    const raw = err.stderr ?? err.stdout ?? err.message ?? String(error);
    const output = (typeof raw === "string" ? raw : raw.toString()).trim();
    if (!output) {
      return ["XSD validation failed"];
    }
    return output.split("\n").filter((line) => line.length > 0);
  }
}
