import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Db } from "@spc-up/db";

import { buildDoacaoDocument, buildDoacaoXml } from "./doacao";
import { CNPJ_PRESTADOR, doacaoPfPixFixture, NR_RECIBO } from "./fixtures";
import { xmlToBuffer } from "./common";

function mockDb(movs: ReturnType<typeof doacaoPfPixFixture>[]): Db {
  return {
    query: {
      doacaoFinanceiraLink: {
        findMany: vi.fn().mockResolvedValue(
          movs.map((mov) => ({
            sincronizado: true,
            movimentacaoOrigem: mov,
          })),
        ),
      },
    },
  } as unknown as Db;
}

describe("buildDoacaoDocument", () => {
  it("includes doador PF and recibo fields", () => {
    const xml = xmlToBuffer(
      buildDoacaoDocument([doacaoPfPixFixture()], CNPJ_PRESTADOR, "SP", 2025),
    ).toString("utf-8");

    expect(xml).toContain("spcaImportacaoArquivo");
    expect(xml).toContain("12345678909");
    expect(xml).toContain(NR_RECIBO);
    expect(xml).toContain("500.00");
    expect(xml).toContain("doadoresOriginarios");
  });

  it("emits totalDoacao 0 when empty", () => {
    const xml = xmlToBuffer(buildDoacaoDocument([], CNPJ_PRESTADOR, "SP", 2025)).toString(
      "utf-8",
    );
    expect(xml.replace(/\s/g, "")).toContain("<totalDoacao>0</totalDoacao>");
  });
});

describe("buildDoacaoXml", () => {
  it("writes empty doacao bundle when no synchronized links", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spc-doacao-"));
    process.env.STORAGE_ROOT = dir;

    const path = await buildDoacaoXml(mockDb([]), "SP", 2025, CNPJ_PRESTADOR);
    const xml = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf-8"));
    expect(xml.replace(/\s/g, "")).toContain("<totalDoacao>0</totalDoacao>");
  });
});
