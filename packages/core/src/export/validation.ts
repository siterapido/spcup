import { validateXml, type SchemaName } from "@spc-up/spca";

export class XsdValidationError extends Error {
  readonly errorsByFile: Record<string, string[]>;

  constructor(errorsByFile: Record<string, string[]>) {
    const invalid = Object.fromEntries(
      Object.entries(errorsByFile).filter(([, errs]) => errs.length > 0),
    );
    super(`XSD validation failed for ${Object.keys(invalid).length} file(s)`);
    this.name = "XsdValidationError";
    this.errorsByFile = errorsByFile;
  }
}

export type ExportFileRef = readonly [SchemaName, string];

/** Validate each XML against its schema; returns errors keyed by filename. */
export async function validateSpcaExports(
  files: ExportFileRef[],
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const [schema, filePath] of files) {
    const name = filePath.split("/").pop() ?? filePath;
    result[name] = await validateXml(filePath, schema);
  }
  return result;
}

/** Raise XsdValidationError if any file has XSD errors. */
export function requireValidXsd(validation: Record<string, string[]>): void {
  const invalid = Object.fromEntries(
    Object.entries(validation).filter(([, errs]) => errs.length > 0),
  );
  if (Object.keys(invalid).length > 0) {
    throw new XsdValidationError(invalid);
  }
}
