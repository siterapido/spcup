import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSAO_DELETE_CODES, softDeleteSessoes } from "./delete-sessao";
import * as purgeSessao from "./purge-sessao-data";

describe("softDeleteSessoes", () => {
  beforeEach(() => {
    vi.spyOn(purgeSessao, "purgeSessaoData").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("remove sessões elegíveis e ignora exportadas e inexistentes", async () => {
    const sessoes = [
      { id: "ok", deletedAt: null },
      { id: "gone", deletedAt: new Date() },
      { id: "blocked", deletedAt: null },
    ];
    const exportedCheck = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "x" }]);
    const select = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: exportedCheck,
        })),
      })),
    }));

    const db = {
      query: {
        sessaoPrestacao: {
          findMany: vi.fn(async () => sessoes),
        },
      },
      select,
    } as unknown as Parameters<typeof softDeleteSessoes>[0];

    const result = await softDeleteSessoes(db, ["ok", "gone", "missing", "blocked"]);

    expect(result.deleted).toBe(2);
    expect(purgeSessao.purgeSessaoData).toHaveBeenCalledTimes(2);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "missing",
          code: SESSAO_DELETE_CODES.NOT_FOUND,
        }),
        expect.objectContaining({
          id: "blocked",
          code: SESSAO_DELETE_CODES.COM_EXPORTADAS,
        }),
      ]),
    );
  });
});
