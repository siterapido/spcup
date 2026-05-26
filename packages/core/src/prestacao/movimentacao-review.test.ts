import { describe, expect, it, vi } from "vitest";

import { assignPessoaToMovimentacao } from "./movimentacao-review";

vi.mock("../match/rules", () => ({
  applyDeterministicMatch: vi.fn().mockResolvedValue({ id: "mov-1" }),
}));

import { applyDeterministicMatch } from "../match/rules";

describe("assignPessoaToMovimentacao", () => {
  const movimentacaoId = "mov-uuid";

  function buildDb() {
    const updateReturning = vi.fn().mockResolvedValue([{ id: movimentacaoId }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    return { db: { update: updateFn }, updateSet };
  }

  it("links PF and clears PJ", async () => {
    const { db, updateSet } = buildDb();
    await assignPessoaToMovimentacao(db as never, movimentacaoId, {
      pessoaFisicaId: "pf-1",
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        pessoaFisicaId: "pf-1",
        pessoaJuridicaId: null,
      }),
    );
    expect(applyDeterministicMatch).toHaveBeenCalledWith(db, movimentacaoId);
  });

  it("links PJ and clears PF", async () => {
    const { db, updateSet } = buildDb();
    await assignPessoaToMovimentacao(db as never, movimentacaoId, {
      pessoaJuridicaId: "pj-1",
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        pessoaFisicaId: null,
        pessoaJuridicaId: "pj-1",
      }),
    );
    expect(applyDeterministicMatch).toHaveBeenCalledWith(db, movimentacaoId);
  });

  it("clears both when limparPessoa", async () => {
    const { db, updateSet } = buildDb();
    await assignPessoaToMovimentacao(db as never, movimentacaoId, {
      limparPessoa: true,
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        pessoaFisicaId: null,
        pessoaJuridicaId: null,
      }),
    );
    expect(applyDeterministicMatch).toHaveBeenCalledWith(db, movimentacaoId);
  });
});
