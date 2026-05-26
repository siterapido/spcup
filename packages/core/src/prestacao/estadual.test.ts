import { describe, expect, it, vi } from "vitest";

import {
  importDiretoriosEstaduais,
  upsertDiretorioEstadualByUf,
} from "./estadual";

function mockDbForUpsert(existing: { id: string; uf: string } | undefined) {
  const updatedRow = {
    id: existing?.id ?? "new-id",
    uf: "SP",
    cnpjPrestador: "12345678000190",
    nome: "Prestação SP",
    ativo: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const returning = vi.fn().mockResolvedValue([updatedRow]);

  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
    query: {
      diretorioEstadual: {
        findFirst: vi.fn().mockResolvedValue(
          existing
            ? {
                id: existing.id,
                uf: existing.uf,
                cnpjPrestador: "00000000000124",
                nome: "Antigo",
                ativo: true,
              }
            : undefined,
        ),
      },
    },
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ returning }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning }),
    }),
  };

  return { db, returning, updatedRow };
}

describe("estadual", () => {
  it("upsertDiretorioEstadualByUf updates existing UF", async () => {
    const { db, returning } = mockDbForUpsert({ id: "dir-sp", uf: "SP" });

    const result = await upsertDiretorioEstadualByUf(db as never, {
      uf: "SP",
      cnpjPrestador: "12.345.678/0001-90",
      nome: "Prestação SP",
    });

    expect(db.update).toHaveBeenCalled();
    expect(returning).toHaveBeenCalled();
    expect(result.uf).toBe("SP");
  });

  it("rejects invalid UF", async () => {
    const { db } = mockDbForUpsert(undefined);

    await expect(
      upsertDiretorioEstadualByUf(db as never, {
        uf: "XX",
        cnpjPrestador: "12345678000190",
        nome: "X",
      }),
    ).rejects.toThrow("UF inválida");
  });

  it("importDiretoriosEstaduais accumulates errors without aborting", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ id: "dir-sp", uf: "SP", cnpjPrestador: "00000000000124", nome: "SP", ativo: true });

    const returning = vi.fn().mockResolvedValue([
      {
        id: "dir-sp",
        uf: "SP",
        cnpjPrestador: "12345678000190",
        nome: "SP",
        ativo: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const db = {
      select: vi.fn(),
      query: { diretorioEstadual: { findFirst } },
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ returning }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({ returning }),
      }),
    };

    const result = await importDiretoriosEstaduais(db as never, [
      { uf: "SP", cnpj_prestador: "12345678000190", nome: "SP OK" },
      { uf: "XX", cnpj_prestador: "12345678000190", nome: "Bad UF" },
      { uf: "RJ", cnpj_prestador: "11222333000181", nome: "RJ OK" },
    ]);

    expect(result.atualizados).toBe(2);
    expect(result.erros).toHaveLength(1);
    expect(result.erros[0]?.linha).toBe(2);
    expect(result.erros[0]?.motivo).toContain("UF inválida");
  });
});
