import { describe, expect, it, vi } from "vitest";

import { movimentacao, matchEvidencia, pessoaFisica } from "@spc-up/db";

import { DEFAULT_WEIGHTS } from "../confidence";
import { applyDeterministicMatch, extractDocumentCandidates, cleanNomeSugestao } from "./rules";

describe("extractDocumentCandidates", () => {
  it("extracts CPF from description", () => {
    const candidates = extractDocumentCandidates(
      "Doacao recebida CPF 123.456.789-09",
    );
    expect(candidates).toContainEqual({
      docType: "CPF",
      normalized: "12345678909",
    });
  });
});

describe("applyDeterministicMatch", () => {
  const movimentacaoId = "mov-uuid";
  const baseMov = {
    id: movimentacaoId,
    descricaoRaw: "Doacao recebida CPF 123.456.789-09",
    confiancaGlobal: 0,
    bloqueioExport: false,
    pessoaFisicaId: null,
    pessoaJuridicaId: null,
  };

  function buildDb(existingPf?: { id: string; cpf: string; nome: string }) {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertFn = vi.fn().mockImplementation((table: unknown) => {
      if (table === matchEvidencia) {
        return { values: insertValues };
      }
      if (table === pessoaFisica) {
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              { id: "pf-new", cpf: "12345678909", nome: "DESCONHECIDO" },
            ]),
          }),
        };
      }
      return { values: vi.fn() };
    });

    const updateReturning = vi.fn().mockResolvedValue([
      {
        ...baseMov,
        confiancaGlobal: DEFAULT_WEIGHTS.CPF_EXATO,
        bloqueioExport: true,
        pessoaFisicaId: existingPf?.id ?? "pf-new",
        pessoaJuridicaId: null,
        status: "PENDENTE_REVISAO",
      },
    ]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const updateFn = vi.fn().mockReturnValue({ set: updateSet });

    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => {
              if (table === movimentacao) {
                return Promise.resolve([baseMov]);
              }
              if (existingPf) {
                return Promise.resolve([existingPf]);
              }
              return Promise.resolve([]);
            }),
          }),
        }),
      }),
      delete: deleteFn,
      insert: insertFn,
      update: updateFn,
    };

    return { db, insertValues };
  }

  it("matches CPF in description", async () => {
    const { db } = buildDb();
    const result = await applyDeterministicMatch(db as never, movimentacaoId);

    expect(result.confiancaGlobal).toBeGreaterThanOrEqual(0.45);
    expect(result.pessoaFisicaId).not.toBeNull();
    expect(result.status).toBe("PENDENTE_REVISAO");
    expect(result.bloqueioExport).toBe(true);
  });

  it("links existing pessoa fisica", async () => {
    const existing = {
      id: "pf-existing",
      cpf: "12345678909",
      nome: "Joao Silva",
    };
    const { db } = buildDb(existing);
    const result = await applyDeterministicMatch(db as never, movimentacaoId);

    expect(result.pessoaFisicaId).toBe(existing.id);
  });
});

describe("cleanNomeSugestao", () => {
  it("removes document and prefixes, returning a clean name", () => {
    expect(
      cleanNomeSugestao("CRED PIX GABRIEL REIS DA SILVA CPF 12345678909", "12345678909"),
    ).toBe("GABRIEL REIS DA SILVA");

    expect(
      cleanNomeSugestao("DEB PIX MERCADINHO CNPJ 12.345.678/0001-99", "12.345.678/0001-99"),
    ).toBe("MERCADINHO");

    expect(
      cleanNomeSugestao("TED GABRIEL REIS DA SILVA CPF 12345678909", "12345678909"),
    ).toBe("GABRIEL REIS DA SILVA");
  });
});
