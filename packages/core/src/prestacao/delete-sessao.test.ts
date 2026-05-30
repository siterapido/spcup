import { describe, expect, it, vi } from "vitest";

import { SESSAO_DELETE_CODES, softDeleteSessoes } from "./delete-sessao";

describe("softDeleteSessoes", () => {
  it("exclui sessão elegível e ignora exportadas e inexistentes", async () => {
    const sessoes = [
      { id: "ok", deletedAt: null },
      { id: "gone", deletedAt: new Date() },
      { id: "blocked", deletedAt: null },
    ];
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    }));
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => []),
          })),
        })),
      })
      .mockReturnValueOnce({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ id: "x" }]),
          })),
        })),
      });

    const db = {
      query: {
        sessaoPrestacao: {
          findMany: vi.fn(async () => sessoes),
        },
      },
      select,
      update,
    } as unknown as Parameters<typeof softDeleteSessoes>[0];

    const result = await softDeleteSessoes(db, ["ok", "gone", "missing", "blocked"]);

    expect(result.deleted).toBe(1);
    expect(update).toHaveBeenCalledTimes(3);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gone",
          code: SESSAO_DELETE_CODES.DELETED,
        }),
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
