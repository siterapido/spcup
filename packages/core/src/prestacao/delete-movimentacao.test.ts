import { describe, expect, it, vi } from "vitest";

import {
  MOVIMENTACAO_DELETE_CODES,
  softDeleteMovimentacoes,
} from "./delete-movimentacao";

describe("softDeleteMovimentacoes", () => {
  it("marca elegíveis e ignora confirmadas, exportadas e já excluídas", async () => {
    const rows = [
      { id: "a", status: "PENDENTE_REVISAO", deletedAt: null },
      { id: "b", status: "CONFIRMADO", deletedAt: null },
      { id: "c", status: "EXPORTADO", deletedAt: null },
      { id: "d", status: "REJEITADO", deletedAt: new Date() },
    ];
    const update = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    }));

    const db = {
      query: {
        movimentacao: {
          findMany: vi.fn(async () => rows),
        },
      },
      update,
    } as unknown as Parameters<typeof softDeleteMovimentacoes>[0];

    const result = await softDeleteMovimentacoes(db, ["a", "b", "c", "d", "x"]);

    expect(result.deleted).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "b",
          code: MOVIMENTACAO_DELETE_CODES.CONFIRMADA,
        }),
        expect.objectContaining({
          id: "c",
          code: MOVIMENTACAO_DELETE_CODES.EXPORTADA,
        }),
        expect.objectContaining({
          id: "d",
          code: MOVIMENTACAO_DELETE_CODES.DELETED,
        }),
        expect.objectContaining({
          id: "x",
          code: MOVIMENTACAO_DELETE_CODES.NOT_FOUND,
        }),
      ]),
    );
  });
});
