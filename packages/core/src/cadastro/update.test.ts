import { describe, expect, it, vi } from "vitest";

import { pessoaFisica, pessoaJuridica } from "@spc-up/db";

import { updatePessoa, updatePessoas } from "./update";

describe("updatePessoa", () => {
  it("updates PF nome", async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pf-1", cpf: "12345678909", nome: "ANTIGO", tituloEleitor: null, aliases: null },
              ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };

    const result = await updatePessoa(db as never, "pf-1", "PF", { nome: "Novo Nome" });
    expect(result).toBe("updated");
    expect(db.update).toHaveBeenCalledWith(pessoaFisica);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ nome: "NOVO NOME", updatedAt: expect.any(Date) }),
    );
  });

  it("returns unchanged when PF nome is equal", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA", tituloEleitor: null, aliases: null },
              ]),
          }),
        }),
      }),
      update: vi.fn(),
    };

    const result = await updatePessoa(db as never, "pf-1", "PF", { nome: "João Silva" });
    expect(result).toBe("unchanged");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns not_found for missing PJ", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      update: vi.fn(),
    };

    const result = await updatePessoa(db as never, "pj-x", "PJ", { nome: "Empresa" });
    expect(result).toBe("not_found");
  });

  it("updates PJ razao social", async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: "pj-1", cnpj: "12345678000199", razaoSocial: "ANTIGA LTDA", aliases: null },
              ]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };

    const result = await updatePessoa(db as never, "pj-1", "PJ", { nome: "Nova LTDA" });
    expect(result).toBe("updated");
    expect(db.update).toHaveBeenCalledWith(pessoaJuridica);
  });
});

describe("updatePessoas", () => {
  it("aggregates updated and skipped", async () => {
    const set = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValueOnce([
                { id: "pf-1", cpf: "1", nome: "A", tituloEleitor: null, aliases: null },
              ])
              .mockResolvedValueOnce([]),
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({ set }),
    };

    const result = await updatePessoas(db as never, [
      { id: "pf-1", tipo: "PF", nome: "B" },
      { id: "pf-2", tipo: "PF", nome: "C" },
    ]);

    expect(result.updated).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe("Cadastro não encontrado");
  });
});
