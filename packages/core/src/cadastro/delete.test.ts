import { describe, expect, it, vi } from "vitest";

import { pessoaFisica } from "@spc-up/db";

import { deletePessoas } from "./delete";

describe("deletePessoas", () => {
  it("soft-deletes PF mesmo com movimentações vinculadas", async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([{ id: "pf-1", deletedAt: null }]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };

    const result = await deletePessoas(db as never, [{ id: "pf-1", tipo: "PF" }]);

    expect(result.deleted).toBe(1);
    expect(result.skipped).toHaveLength(0);
    expect(db.update).toHaveBeenCalledWith(pessoaFisica);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("ignora cadastro já excluído", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([{ id: "pf-1", deletedAt: new Date() }]),
          }),
        }),
      }),
      update: vi.fn(),
    };

    const result = await deletePessoas(db as never, [{ id: "pf-1", tipo: "PF" }]);

    expect(result.deleted).toBe(0);
    expect(result.skipped[0]?.reason).toBe("Cadastro já excluído");
    expect(db.update).not.toHaveBeenCalled();
  });
});
