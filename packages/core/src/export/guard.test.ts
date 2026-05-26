import { describe, expect, it, vi } from "vitest";

import type { Db } from "@spc-up/db";

import { canExportByPrestador } from "./guard";

function createMockDb(rows: { id: string }[]): Db {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  return { select } as unknown as Db;
}

describe("canExportByPrestador", () => {
  it("returns false when pending movimentacoes exist", async () => {
    const db = createMockDb([{ id: "mov-1" }]);

    await expect(canExportByPrestador(db, "11111111000111", 2025)).resolves.toBe(
      false,
    );
  });

  it("returns true when all movimentacoes are confirmed", async () => {
    const db = createMockDb([]);

    await expect(canExportByPrestador(db, "11111111000111", 2025)).resolves.toBe(
      true,
    );
  });
});
