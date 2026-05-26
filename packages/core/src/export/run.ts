import archiver from "archiver";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { eq } from "drizzle-orm";

import { diretorioEstadual, type Db } from "@spc-up/db";
import type { SchemaName } from "@spc-up/spca";

import { buildAplicacaoXml } from "./aplicacao";
import { buildDoacaoXml } from "./doacao";
import { buildExcelMirrorBuffer } from "./excel-mirror";
import { canExport, canExportByPrestador } from "./guard";
import { generatePendenciasCsvByPrestador } from "../report/pendencias";
import { buildOrigemXml } from "./origem";
import { requireValidXsd, validateSpcaExports, XsdValidationError } from "./validation";

export { canExport, canExportByPrestador } from "./guard";
export { XsdValidationError };

export class ExportBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportBlockedError";
  }
}

export interface ExportZipResult {
  buffer: Buffer;
  filename: string;
  validacao: Record<string, string[]>;
}

const SCHEMA_BY_STEM: Record<string, SchemaName> = {
  origem: "origem",
  aplicacao: "aplicacao",
  doacao: "doacao",
};

/** Build XML exports for a prestador. Raises if export is blocked. */
export async function exportBundleByPrestador(
  db: Db,
  cnpjPrestador: string,
  uf: string,
  exercicio: number,
  outDir: string,
): Promise<string[]> {
  const ufUpper = uf.toUpperCase();
  if (!(await canExportByPrestador(db, cnpjPrestador, exercicio))) {
    throw new ExportBlockedError(
      `Export blocked for ${cnpjPrestador}/${exercicio}: resolve pendencias before exporting`,
    );
  }

  const built = await Promise.all([
    buildOrigemXml(db, ufUpper, exercicio, cnpjPrestador),
    buildAplicacaoXml(db, ufUpper, exercicio, cnpjPrestador),
    buildDoacaoXml(db, ufUpper, exercicio, cnpjPrestador),
  ]);

  await mkdir(outDir, { recursive: true });

  const copied: string[] = [];
  const filesToValidate: Array<readonly [SchemaName, string]> = [];

  for (const source of built) {
    const target = join(outDir, basename(source));
    await copyFile(source, target);
    copied.push(target);

    const stem = Object.keys(SCHEMA_BY_STEM).find((key) => basename(source).includes(key));
    if (stem) {
      filesToValidate.push([SCHEMA_BY_STEM[stem]!, target]);
    }
  }

  const validation = await validateSpcaExports(filesToValidate);
  requireValidXsd(validation);

  const validacaoPath = join(outDir, "validacao.json");
  await writeFile(validacaoPath, JSON.stringify(validation, null, 2), "utf-8");
  copied.push(validacaoPath);
  return copied;
}

/** Legacy estadual export bundle. */
export async function exportBundle(
  db: Db,
  uf: string,
  exercicio: number,
  outDir: string,
): Promise<string[]> {
  const ufUpper = uf.toUpperCase();
  const rows = await db
    .select()
    .from(diretorioEstadual)
    .where(eq(diretorioEstadual.uf, ufUpper))
    .limit(1);
  const diretorio = rows[0];
  if (diretorio == null) {
    throw new Error(`Diretorio estadual not found for UF=${uf}`);
  }
  return exportBundleByPrestador(db, diretorio.cnpjPrestador, ufUpper, exercicio, outDir);
}

/** Full export ZIP: XML + pendencias + Excel espelho. */
export async function exportPrestacaoZip(
  db: Db,
  cnpjPrestador: string,
  uf: string,
  exercicio: number,
): Promise<ExportZipResult> {
  const ufUpper = uf.toUpperCase();
  const tmpBase = await mkdtemp(join(tmpdir(), "spc-export-"));
  const copied = await exportBundleByPrestador(
    db,
    cnpjPrestador,
    ufUpper,
    exercicio,
    tmpBase,
  );

  const pendenciasPath = join(tmpBase, "pendencias.csv");
  await generatePendenciasCsvByPrestador(db, cnpjPrestador, exercicio, pendenciasPath);
  copied.push(pendenciasPath);

  const espelhoBuffer = await buildExcelMirrorBuffer(db, cnpjPrestador, exercicio);
  const espelhoPath = join(tmpBase, "espelho.xlsx");
  await writeFile(espelhoPath, espelhoBuffer);
  copied.push(espelhoPath);

  const filesToZip = copied.filter(
    (p) => p.endsWith(".xml") || p.endsWith(".csv") || p.endsWith(".xlsx"),
  );
  const buffer = await zipFiles(filesToZip);
  const validacao = JSON.parse(
    await readFile(join(tmpBase, "validacao.json"), "utf-8"),
  ) as Record<string, string[]>;

  return {
    buffer,
    filename: `spca_${cnpjPrestador}_${exercicio}.zip`,
    validacao,
  };
}

/** Build validated SPCA XML bundle as a ZIP (web download, estadual UF). */
export async function exportSpcaZip(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<ExportZipResult> {
  const ufUpper = uf.toUpperCase();
  const rows = await db
    .select()
    .from(diretorioEstadual)
    .where(eq(diretorioEstadual.uf, ufUpper))
    .limit(1);
  const diretorio = rows[0];
  if (diretorio == null) {
    throw new Error(`Diretorio estadual not found for UF=${uf}`);
  }
  return exportPrestacaoZip(db, diretorio.cnpjPrestador, ufUpper, exercicio);
}

async function zipFiles(paths: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    for (const filePath of paths) {
      archive.file(filePath, { name: basename(filePath) });
    }
    archive.finalize();
  });
}
