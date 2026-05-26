import { describe, expect, it, vi } from "vitest";

import { cadastroConflito, pessoaFisica, pessoaJuridica } from "@spc-up/db";

import { STUB_PF_NOME } from "./constants";
import { upsertPessoa } from "./upsert";

describe("upsertPessoa", () => {
  const ctx = { uf: "SP", exercicio: 2025, origem: "IMPORT" as const };

  it("inserts new PF", async () => {
    const returning = vi.fn().mockResolvedValue([
      { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA" },
    ]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning }) }),
    };

    const result = await upsertPessoa(
      db as never,
      { tipo: "PF", documento: "12345678909", nome: "JOAO SILVA" },
      ctx,
    );
    expect(result.action).toBe("inserted");
    expect(result.pessoaFisicaId).toBe("pf-1");
  });

  it("updates stub PF name", async () => {
    const updateReturning = vi
      .fn()
      .mockResolvedValue([{ id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA" }]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pf-1", cpf: "12345678909", nome: STUB_PF_NOME },
              ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning: updateReturning }),
        }),
      }),
    };

    const result = await upsertPessoa(
      db as never,
      { tipo: "PF", documento: "12345678909", nome: "JOAO SILVA" },
      ctx,
    );
    expect(result.action).toBe("updated");
  });

  it("creates conflict when names differ", async () => {
    const conflitoReturning = vi.fn().mockResolvedValue([{ id: "conf-1" }]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pf-1", cpf: "12345678909", nome: "MARIA SOUZA" },
              ]),
          }),
        }),
      }),
      insert: vi.fn().mockImplementation((table: unknown) => {
        if (table === cadastroConflito) {
          return { values: vi.fn().mockReturnValue({ returning: conflitoReturning }) };
        }
        return { values: vi.fn() };
      }),
    };

    const result = await upsertPessoa(
      db as never,
      { tipo: "PF", documento: "12345678909", nome: "JOAO SILVA" },
      ctx,
    );
    expect(result.action).toBe("conflict");
    expect(result.conflitoId).toBe("conf-1");
  });

  it("returns unchanged when nome matches", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA" },
              ]),
          }),
        }),
      }),
    };

    const result = await upsertPessoa(
      db as never,
      { tipo: "PF", documento: "12345678909", nome: "JOAO SILVA" },
      ctx,
    );
    expect(result.action).toBe("unchanged");
  });
});
