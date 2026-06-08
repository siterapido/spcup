import { describe, expect, it, vi } from "vitest";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";
import {
  compararNomeComPessoa,
  findPessoasByNomeFuzzy,
  resolveCadastroLink,
} from "./cadastro-link";

describe("compararNomeComPessoa", () => {
  it("bate com alias", () => {
    expect(
      compararNomeComPessoa("JOAO SILVA", {
        nome: "JOAO DA SILVA",
        aliases: ["JOAO SILVA"],
      }),
    ).toBe("bate");
  });
});

describe("findPessoasByNomeFuzzy", () => {
  it("returns empty for short name", async () => {
    const db = { select: vi.fn() } as never;
    await expect(findPessoasByNomeFuzzy(db, "AB")).resolves.toEqual([]);
  });
});

describe("resolveCadastroLink", () => {
  it("ALTA when cpf in cadastro and nome bate", async () => {
    const pf = { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(table === pessoaFisica ? [pf] : []),
          }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "JOAO SILVA",
    });
    expect(result.tier).toBe("ALTA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("bate");
  });

  it("BAIXA when cpf not in cadastro", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "JOAO SILVA",
    });
    expect(result.tier).toBe("BAIXA");
    expect(result.pessoaFisicaId).toBeNull();
  });

  it("REJEITADO when cpf and cnpj both set", async () => {
    const db = { select: vi.fn() } as never;
    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: "12345678000199",
      remetenteDestinatario: "X",
    });
    expect(result.tier).toBe("REJEITADO");
  });

  it("MEDIA when cpf in cadastro but nome difere", async () => {
    const pf = { id: "pf-1", cpf: "12345678909", nome: "MARIA SOUZA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(table === pessoaFisica ? [pf] : []),
          }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "CARLOS REIS",
    });
    expect(result.tier).toBe("MEDIA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("difere");
  });

  it("REJEITADO when homonym: 2 PF fuzzy matches, no doc", async () => {
    const pf1 = { id: "pf-1", nome: "JOAO SILVA", aliases: null };
    const pf2 = { id: "pf-2", nome: "JOAO SILVA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) =>
          Promise.resolve(table === pessoaFisica ? [pf1, pf2] : []),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: null,
      cnpj: null,
      remetenteDestinatario: "JOAO SILVA",
    });
    expect(result.tier).toBe("REJEITADO");
    expect(result.pessoaFisicaId).toBeNull();
    expect(result.evidencias.some((e) => e.tipo === "CONFLITO_NOME")).toBe(true);
  });

  it("MEDIA when nome-only: one PF fuzzy match, no doc", async () => {
    const pf = { id: "pf-1", nome: "MARIA SOUZA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) =>
          Promise.resolve(table === pessoaFisica ? [pf] : []),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: null,
      cnpj: null,
      remetenteDestinatario: "MARIA SOUZA",
    });
    expect(result.tier).toBe("MEDIA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("bate");
  });

  it("MEDIA when cpf in cadastro and remetenteDestinatario null", async () => {
    const pf = { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(table === pessoaFisica ? [pf] : []),
          }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: null,
    });
    expect(result.tier).toBe("MEDIA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("indefinido");
  });

  it("BAIXA when all null/empty", async () => {
    const db = { select: vi.fn() } as never;

    const result = await resolveCadastroLink(db, {
      cpf: null,
      cnpj: null,
      remetenteDestinatario: null,
    });
    expect(result.tier).toBe("BAIXA");
    expect(result.pessoaFisicaId).toBeNull();
    expect(result.pessoaJuridicaId).toBeNull();
    expect(result.comparacaoNome).toBe("indefinido");
  });
});
