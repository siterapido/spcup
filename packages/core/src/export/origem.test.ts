import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { schemaPath, validateXml } from "@spc-up/spca";
import { describe, expect, it, vi } from "vitest";

import type { Db } from "@spc-up/db";

import { buildOrigemDocument, buildOrigemXml } from "./origem";
import { CNPJ_PRESTADOR, origemPfPixFixture } from "./fixtures";
import { xmlToBuffer } from "./common";

function mockDb(movs: ReturnType<typeof origemPfPixFixture>[]): Db {
  return {
    query: {
      movimentacao: {
        findMany: vi.fn().mockResolvedValue(movs),
      },
    },
  } as unknown as Db;
}

describe("buildOrigemDocument", () => {
  it("includes PIX transfer and PF fields", () => {
    const xml = xmlToBuffer(
      buildOrigemDocument([origemPfPixFixture()], CNPJ_PRESTADOR, 2025),
    ).toString("utf-8");

    expect(xml).toContain("transferenciaEletronicaPIX");
    expect(xml).toContain("12345678909");
    expect(xml).toContain("314");
  });
});

describe("buildOrigemXml", () => {
  it("writes file under STORAGE_ROOT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spc-origem-"));
    process.env.STORAGE_ROOT = dir;

    const path = await buildOrigemXml(mockDb([origemPfPixFixture()]), "SP", 2025, CNPJ_PRESTADOR);

    await expect(access(path)).resolves.toBeUndefined();
    const xml = await readFile(path, "utf-8");
    expect(xml).toContain("transferenciaEletronicaPIX");
  });

  it("validates against origem XSD when schema and xmllint exist", async () => {
    let schemaOk = false;
    try {
      await access(schemaPath("origem"));
      schemaOk = true;
    } catch {
      schemaOk = false;
    }
    if (!schemaOk) {
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "spc-origem-xsd-"));
    process.env.STORAGE_ROOT = dir;
    const path = await buildOrigemXml(
      mockDb([origemPfPixFixture()]),
      "SP",
      2025,
      CNPJ_PRESTADOR,
    );

    const errors = await validateXml(path, "origem");
    expect(errors).toEqual([]);
  });
});
