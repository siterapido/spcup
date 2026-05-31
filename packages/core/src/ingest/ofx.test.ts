import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { computeHashMovimento, parseOfx, persistTransactions } from "./ofx";
import { MOVIMENTACAO_STATUS, TIPO_PRESTADOR } from "./types";

const PRESTADOR_SP = {
  cnpjPrestador: "14679407000100",
  tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
};

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(fixtureDir, "../../fixtures/sample.ofx");

describe("parseOfx", () => {
  it("parses entrada and saida directions", async () => {
    const rows = await parseOfx(FIXTURE_PATH);
    expect(rows.some((r) => r.direcao === "ENTRADA")).toBe(true);
    expect(rows.some((r) => r.direcao === "SAIDA")).toBe(true);
  });

  it("returns expected fields", async () => {
    const rows = await parseOfx(FIXTURE_PATH);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.valor).toMatch(/^\d+\.\d{2}$/);
      expect(row.direcao).toMatch(/^(ENTRADA|SAIDA)$/);
      expect(row.dataMovimento).toBeInstanceOf(Date);
      expect(typeof row.descricaoRaw).toBe("string");
      expect(row.nrExtratoBancario).toBeTruthy();
    }
  });
});

describe("computeHashMovimento", () => {
  it("produces stable sha256 hex digest", async () => {
    const rows = await parseOfx(FIXTURE_PATH);
    const row = rows[0]!;
    const digest = computeHashMovimento(PRESTADOR_SP.cnpjPrestador, 2025, row);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(computeHashMovimento(PRESTADOR_SP.cnpjPrestador, 2025, row));
  });
});

describe("persistTransactions", () => {
  it("creates rascunho movimentacoes with hashes", async () => {
    const rows = await parseOfx(FIXTURE_PATH);
    const returning = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "mov-1",
          status: MOVIMENTACAO_STATUS.RASCUNHO,
          arquivoIngestaoId: "arquivo-1",
          hashMovimento: computeHashMovimento(PRESTADOR_SP.cnpjPrestador, 2025, rows[0]!),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "mov-2",
          status: MOVIMENTACAO_STATUS.RASCUNHO,
          arquivoIngestaoId: "arquivo-1",
          hashMovimento: computeHashMovimento(PRESTADOR_SP.cnpjPrestador, 2025, rows[1]!),
        },
      ]);

    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as never;

    const created = await persistTransactions(
      db,
      "SP",
      2025,
      "arquivo-1",
      rows,
      PRESTADOR_SP,
    );

    expect(created).toHaveLength(2);
    for (const mov of created) {
      expect(mov.status).toBe(MOVIMENTACAO_STATUS.RASCUNHO);
      expect(mov.arquivoIngestaoId).toBe("arquivo-1");
      expect(mov.hashMovimento).toHaveLength(64);
    }
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it("handles duplicate conflicts gracefully and returns only newly created records", async () => {
    const rows = await parseOfx(FIXTURE_PATH);
    const returning = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "mov-1",
          status: MOVIMENTACAO_STATUS.RASCUNHO,
          arquivoIngestaoId: "arquivo-1",
          hashMovimento: computeHashMovimento(PRESTADOR_SP.cnpjPrestador, 2025, rows[0]!),
        },
      ])
      .mockResolvedValueOnce([]); // Mock conflict where nothing is returned

    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn().mockReturnValue({ values });
    const db = { insert } as never;

    const created = await persistTransactions(
      db,
      "SP",
      2025,
      "arquivo-1",
      rows,
      PRESTADOR_SP,
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.id).toBe("mov-1");
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
