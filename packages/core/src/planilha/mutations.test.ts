import { describe, expect, it, vi } from "vitest";

import { consolidacaoEvento, movimentacao } from "@spc-up/db";

import { loadCadastroMatchContext } from "../consolidacao/load";
import { applyDeterministicMatch } from "../match/rules";
import { resolvePlanilhaMerge, updatePlanilhaLinhaNome } from "./mutations";

vi.mock("../match/rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../match/rules")>();
  return {
    ...actual,
    applyDeterministicMatch: vi.fn(),
  };
});

vi.mock("../consolidacao/load", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../consolidacao/load")>();
  return {
    ...actual,
    loadCadastroMatchContext: vi.fn(),
  };
});

describe("resolvePlanilhaMerge", () => {
  it("confirmar delega approveConsolidacaoEvento", async () => {
    const approve = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "confirmar", {
      approveConsolidacaoEvento: approve,
    });
    expect(approve).toHaveBeenCalledWith(db, "ev-1");
  });

  it("separar delega rejectConsolidacaoEvento", async () => {
    const reject = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "separar", {
      rejectConsolidacaoEvento: reject,
    });
    expect(reject).toHaveBeenCalledWith(db, "ev-1");
  });
});

describe("updatePlanilhaLinhaNome", () => {
  it("movimentacao sem PF/PJ dispara applyDeterministicMatch", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const findFirst = vi.fn().mockResolvedValue({
      pessoaFisicaId: null,
      pessoaJuridicaId: null,
    });

    const db = {
      update: updateFn,
      query: {
        movimentacao: { findFirst },
        consolidacaoEvento: { findFirst: vi.fn() },
      },
    } as never;

    await updatePlanilhaLinhaNome(db, "mov-1", "movimentacao", "MARIA SILVA");

    expect(updateFn).toHaveBeenCalledWith(movimentacao);
    expect(updateSet).toHaveBeenCalledWith({ nomeContraparte: "MARIA SILVA" });
    expect(applyDeterministicMatch).toHaveBeenCalledWith(db, "mov-1");
  });

  it("movimentacao com PF vinculado nao rematch", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const findFirst = vi.fn().mockResolvedValue({
      pessoaFisicaId: "pf-1",
      pessoaJuridicaId: null,
    });

    const db = {
      update: updateFn,
      query: {
        movimentacao: { findFirst },
        consolidacaoEvento: { findFirst: vi.fn() },
      },
    } as never;

    vi.mocked(applyDeterministicMatch).mockClear();
    await updatePlanilhaLinhaNome(db, "mov-1", "movimentacao", "OUTRO NOME");

    expect(applyDeterministicMatch).not.toHaveBeenCalled();
  });

  it("consolidacao sem PF/PJ tenta rematch por nome", async () => {
    vi.mocked(loadCadastroMatchContext).mockResolvedValue({
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const eventoFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ pessoaFisicaId: null, pessoaJuridicaId: null })
      .mockResolvedValueOnce({
        nomeContraparte: "MARIA SILVA",
        linhas: [
          {
            papel: "COMPLETO",
            movimentacao: { descricaoRaw: "CRED PIX" },
          },
        ],
      });

    const pfSelectLimit = vi.fn().mockResolvedValue([{ id: "pf-maria" }]);
    const pfSelectWhere = vi.fn().mockReturnValue({ limit: pfSelectLimit });
    const pfSelectFrom = vi.fn().mockReturnValue({ where: pfSelectWhere });
    const pfSelect = vi.fn().mockReturnValue({ from: pfSelectFrom });

    const pjSelectLimit = vi.fn().mockResolvedValue([]);
    const pjSelectWhere = vi.fn().mockReturnValue({ limit: pjSelectLimit });
    const pjSelectFrom = vi.fn().mockReturnValue({ where: pjSelectWhere });
    const pjSelect = vi.fn().mockReturnValue({ from: pjSelectFrom });

    const db = {
      update: updateFn,
      select: vi
        .fn()
        .mockImplementationOnce(() => pfSelect())
        .mockImplementationOnce(() => pjSelect()),
      query: {
        movimentacao: { findFirst: vi.fn() },
        consolidacaoEvento: { findFirst: eventoFindFirst },
      },
    } as never;

    await updatePlanilhaLinhaNome(db, "ev-1", "consolidacao", "MARIA SILVA");

    expect(updateFn).toHaveBeenCalledWith(consolidacaoEvento);
    expect(updateSet).toHaveBeenCalledWith({ nomeContraparte: "MARIA SILVA" });
    expect(updateFn).toHaveBeenCalledTimes(2);
    expect(updateSet).toHaveBeenLastCalledWith({
      pessoaFisicaId: "pf-maria",
      pessoaJuridicaId: null,
      confianca: 0.85,
      justificativa: "Nome único no cadastro",
    });
  });

  it("normaliza null quando nome vazio", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const findFirst = vi.fn().mockResolvedValue({
      pessoaFisicaId: "pf-1",
      pessoaJuridicaId: null,
    });

    const db = {
      update: updateFn,
      query: {
        movimentacao: { findFirst },
        consolidacaoEvento: { findFirst: vi.fn() },
      },
    } as never;

    await updatePlanilhaLinhaNome(db, "mov-1", "movimentacao", "  ");

    expect(updateSet).toHaveBeenCalledWith({ nomeContraparte: null });
  });
});
