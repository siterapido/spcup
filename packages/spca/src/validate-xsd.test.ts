import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { schemaPath, validateXml } from "./validate-xsd.js";

function hasXmllint(): boolean {
  try {
    execFileSync("xmllint", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

const xmllintAvailable = hasXmllint();

describe("validate-xsd", () => {
  it("exposes bundled origem schema", async () => {
    await expect(access(schemaPath("origem"), constants.F_OK)).resolves.toBeUndefined();
  });

  it("exposes bundled aplicacao schema", async () => {
    await expect(access(schemaPath("aplicacao"), constants.F_OK)).resolves.toBeUndefined();
  });

  it("exposes bundled doacao schema", async () => {
    await expect(access(schemaPath("doacao"), constants.F_OK)).resolves.toBeUndefined();
  });

  it.skipIf(!xmllintAvailable)("validates minimal origem xml", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
  <CABECALHO><nrCnpjPrestador>23738595000182</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
  <CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO>
</spcaImportacaoArquivo>`;

    const dir = await mkdtemp(join(tmpdir(), "spca-xsd-"));
    const filePath = join(dir, "t.xml");

    try {
      await writeFile(filePath, xml, "utf-8");
      const errors = await validateXml(filePath, "origem");
      expect(errors).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
