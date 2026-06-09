import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canExportMock = vi.fn<() => Promise<boolean>>();
const exportBundleMock = vi.fn();

vi.mock("@spc-up/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spc-up/core")>();
  return {
    ...actual,
    canExport: (...args: Parameters<typeof actual.canExport>) => canExportMock(...args),
    exportBundle: (...args: Parameters<typeof actual.exportBundle>) =>
      exportBundleMock(...args),
  };
});

import { createProgram } from "./main";
import { runExport } from "./commands/export";
import { runValidateXsd } from "./commands/validate-xsd";

const MINIMAL_ORIGEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
  <CABECALHO><nrCnpjPrestador>23738595000182</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
  <CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO>
</spcaImportacaoArquivo>`;

function hasXmllint(): boolean {
  try {
    execFileSync("xmllint", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const xmllintAvailable = hasXmllint();

vi.mock("@spc-up/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spc-up/db")>();
  return {
    ...actual,
    getDb: vi.fn(() => ({})),
  };
});

describe("CLI program", () => {
  it("lists ingest and validate-xsd in root help", () => {
    const help = createProgram().helpInformation();
    expect(help).toContain("cadastro");
    expect(help).toContain("prestacao");
    expect(help).toContain("ingest");
    expect(help).toContain("pendencias");
    expect(help).toContain("confirm");
    expect(help).toContain("export");
    expect(help).toContain("validate-xsd");
  });

  it("shows ingest options in subcommand help", () => {
    const ingest = createProgram().commands.find((c) => c.name() === "ingest");
    expect(ingest).toBeDefined();
    const help = ingest!.helpInformation();
    expect(help).toContain("--uf");
    expect(help).toContain("--exercicio");
    expect(help).toContain("--path");
  });

  it("rejects ingest without required options", async () => {
    const program = createProgram();
    await expect(program.parseAsync(["ingest"], { from: "user" })).rejects.toThrow();
  });
});

describe("runValidateXsd", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = 0;
  });

  it("rejects unknown schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-xsd-"));
    const filePath = join(dir, "t.xml");
    try {
      await writeFile(filePath, MINIMAL_ORIGEM_XML, "utf-8");
      await expect(
        runValidateXsd({ file: filePath, schema: "invalid" }),
      ).rejects.toThrow("--schema must be origem, aplicacao or doacao");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!xmllintAvailable)("validates minimal origem xml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-xsd-"));
    const filePath = join(dir, "origem.xml");
    try {
      await writeFile(filePath, MINIMAL_ORIGEM_XML, "utf-8");
      await runValidateXsd({ file: filePath, schema: "origem" });
      expect(process.exitCode).not.toBe(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^OK — .* válido para schema 'origem'\.$/),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails on invalid xml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-xsd-"));
    const filePath = join(dir, "bad.xml");
    try {
      await writeFile(filePath, "<root/>", "utf-8");
      await runValidateXsd({ file: filePath, schema: "origem" });
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("runExport", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("prints blocked message when canExport is false", async () => {
    canExportMock.mockResolvedValue(false);
    exportBundleMock.mockClear();

    const outDir = await mkdtemp(join(tmpdir(), "cli-export-"));
    try {
      await runExport({ uf: "SP", exercicio: "2025", out: outDir });
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        "Exportação bloqueada: existem pendências ou bloqueio_export para este UF/exercício.",
      );
      expect(exportBundleMock).not.toHaveBeenCalled();
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

describe("bundled origem schema", () => {
  it("is available for validate-xsd", async () => {
    const { schemaPath } = await import("@spc-up/spca");
    await expect(access(schemaPath("origem"), constants.F_OK)).resolves.toBeUndefined();
  });
});
