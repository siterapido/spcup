import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Db } from "@spc-up/db";

import { buildAplicacaoDocument, buildAplicacaoXml } from "./aplicacao";
import { aplicacaoPjReciboFixture, CNPJ_PRESTADOR } from "./fixtures";
import { xmlToBuffer } from "./common";

function mockDb(movs: ReturnType<typeof aplicacaoPjReciboFixture>[]): Db {
  return {
    query: {
      movimentacao: {
        findMany: vi.fn().mockResolvedValue(movs),
      },
    },
  } as unknown as Db;
}

describe("buildAplicacaoDocument", () => {
  it("includes PJ recibo and classificacao gasto", () => {
    const xml = xmlToBuffer(
      buildAplicacaoDocument([aplicacaoPjReciboFixture()], CNPJ_PRESTADOR, 2025),
    ).toString("utf-8");

    expect(xml).toContain("importacaoAplicacaoRecurso");
    expect(xml).toContain("pessoaJuridica");
    expect(xml).toContain("11222333000181");
    expect(xml).toContain("recibo");
    expect(xml).toContain("401");
    expect(xml).toContain("situacao1");
    expect(xml).toContain("Pagamento paginas internet");
  });
});

describe("buildAplicacaoXml", () => {
  it("writes aplicacao file to storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spc-aplic-"));
    process.env.STORAGE_ROOT = dir;

    const path = await buildAplicacaoXml(
      mockDb([aplicacaoPjReciboFixture()]),
      "SP",
      2025,
      CNPJ_PRESTADOR,
    );

    const xml = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf-8"));
    expect(xml).toContain("importacaoAplicacaoRecurso");
  });
});
