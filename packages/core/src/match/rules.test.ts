import { describe, expect, it, vi } from "vitest";

import {
  movimentacao,
  matchEvidencia,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";

import * as confidence from "../confidence";
import { DEFAULT_WEIGHTS } from "../confidence";
import {
  applyDeterministicMatch,
  cleanNomeSugestao,
  extractDocumentCandidates,
  findCpfInDescricao,
  hasCpfInDescricao,
  stripDocumentsFromDescricao,
} from "./rules";

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

describe("cpf in descricao helpers", () => {
  it("finds masked and plain CPF", () => {
    expect(findCpfInDescricao("PIX CPF 123.456.789-09")).toBe("123.456.789-09");
    expect(findCpfInDescricao("PIX 12345678909")).toBe("12345678909");
    expect(hasCpfInDescricao("PIX CPF 123.456.789-09")).toBe(true);
  });

  it("strips masked CPF from description", () => {
    expect(stripDocumentsFromDescricao("Doacao CPF 123.456.789-09")).toBe(
      "Doacao",
    );
  });
});

function mockFromTable(
  table: unknown,
  opts: {
    movRows?: unknown[];
    pfRows?: unknown[];
    pjRows?: unknown[];
  },
) {
  const pfRows = opts.pfRows ?? [];
  const pjRows = opts.pjRows ?? [];

  if (table === movimentacao) {
    return {
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(opts.movRows ?? []),
      }),
    };
  }

  if (table === pessoaFisica) {
    const chain = {
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(pfRows),
      }),
      then(onFulfilled: (v: unknown[]) => unknown) {
        return Promise.resolve(pfRows).then(onFulfilled);
      },
    };
    return chain;
  }

  if (table === pessoaJuridica) {
    const chain = {
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(pjRows),
      }),
      then(onFulfilled: (v: unknown[]) => unknown) {
        return Promise.resolve(pjRows).then(onFulfilled);
      },
    };
    return chain;
  }

  return {
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  };
}

function buildUpdateEcho(baseMov: Record<string, unknown>) {
  let updatePayload: Record<string, unknown> = {};
  const updateReturning = vi.fn().mockImplementation(() =>
    Promise.resolve([{ ...baseMov, ...updatePayload }]),
  );
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const updateSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    updatePayload = data;
    return { where: updateWhere };
  });
  const updateFn = vi.fn().mockReturnValue({ set: updateSet });
  return { updateFn, updatePayload: () => updatePayload };
}

describe("applyDeterministicMatch", () => {
  const movimentacaoId = "mov-uuid";
  const baseMov = {
    id: movimentacaoId,
    descricaoRaw: "Doacao recebida CPF 123.456.789-09",
    remetenteDestinatario: "Joao Silva",
    origemExtracao: {
      versao: 1 as const,
      arquivoIngestaoId: "arq-1",
      nomeArquivo: "extrato.pdf",
      pagina: 1,
      indiceLinha: 1,
      cpfContraparte: "12345678909",
      cnpjContraparte: null,
    },
    confiancaGlobal: 0,
    bloqueioExport: false,
    pessoaFisicaId: null,
    pessoaJuridicaId: null,
  };

  function buildDb(existingPf?: {
    id: string;
    cpf: string;
    nome: string;
    aliases?: string[] | null;
  }) {
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertFn = vi.fn().mockImplementation((table: unknown) => {
      if (table === matchEvidencia) {
        return { values: insertValues };
      }
      return { values: vi.fn() };
    });

    const { updateFn } = buildUpdateEcho(baseMov);

    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) =>
          mockFromTable(table, {
            movRows: [baseMov],
            pfRows: existingPf ? [existingPf] : [],
          }),
      }),
      delete: deleteFn,
      insert: insertFn,
      update: updateFn,
    };

    return { db, insertValues, insertFn };
  }

  it("ignores CPF only in descricaoRaw without origem estruturada", async () => {
    const movSemOrigem = {
      ...baseMov,
      origemExtracao: null,
      remetenteDestinatario: null,
    };
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertFn = vi.fn().mockImplementation((table: unknown) => {
      if (table === matchEvidencia) {
        return { values: insertValues };
      }
      return { values: vi.fn() };
    });
    const { updateFn } = buildUpdateEcho(movSemOrigem);
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) =>
          mockFromTable(table, { movRows: [movSemOrigem] }),
      }),
      delete: deleteFn,
      insert: insertFn,
      update: updateFn,
    };

    const result = await applyDeterministicMatch(db as never, movimentacaoId);
    expect(result.pessoaFisicaId).toBeNull();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("does not create stub when cpf missing from cadastro", async () => {
    const { db, insertFn } = buildDb();
    const result = await applyDeterministicMatch(db as never, movimentacaoId);
    expect(result.pessoaFisicaId).toBeNull();
    const pfInserts = insertFn.mock.calls.filter((c) => c[0] === pessoaFisica);
    expect(pfInserts).toHaveLength(0);
  });

  it("matches CPF from origem estruturada without cadastro", async () => {
    const { db, insertFn } = buildDb();
    const result = await applyDeterministicMatch(db as never, movimentacaoId);

    expect(result.pessoaFisicaId).toBeNull();
    const pfInserts = insertFn.mock.calls.filter((c) => c[0] === pessoaFisica);
    expect(pfInserts).toHaveLength(0);
    expect(result.status).toBe("PENDENTE_REVISAO");
    expect(result.bloqueioExport).toBe(true);
  });

  it("links existing pessoa fisica with nome bate — CONFIRMADO when score high enough", async () => {
    const existing = {
      id: "pf-existing",
      cpf: "12345678909",
      nome: "Joao Silva",
      aliases: null,
    };
    const evalSpy = vi
      .spyOn(confidence, "evaluateMovimentacao")
      .mockImplementation((mov) => {
        mov.confianca_global = DEFAULT_WEIGHTS.CPF_EXATO;
        mov.bloqueio_export = false;
        return DEFAULT_WEIGHTS.CPF_EXATO;
      });

    const { db } = buildDb(existing);
    const result = await applyDeterministicMatch(db as never, movimentacaoId, {
      confiancaLimiteAlta: DEFAULT_WEIGHTS.CPF_EXATO,
    });
    evalSpy.mockRestore();

    expect(result.pessoaFisicaId).toBe(existing.id);
    expect(result.status).toBe("CONFIRMADO");
  });

  it("links existing pessoa fisica with nome difere — MEDIA tier stays PENDENTE_REVISAO", async () => {
    const existing = {
      id: "pf-existing",
      cpf: "12345678909",
      nome: "Maria Oliveira",
      aliases: null,
    };
    const { db } = buildDb(existing);
    const result = await applyDeterministicMatch(db as never, movimentacaoId, {
      confiancaLimiteAlta: 0.4,
    });

    expect(result.pessoaFisicaId).toBe(existing.id);
    expect(result.status).toBe("PENDENTE_REVISAO");
    expect(result.status).not.toBe("CONFIRMADO");
  });

  it("matches cadastro by remetenteDestinatario when descricaoRaw is only CRED PIX", async () => {
    const movimentacaoIdNome = "mov-nome-uuid";
    const existingPf = {
      id: "pf-maria",
      cpf: "12345678901",
      nome: "MARIA SILVA",
      aliases: null,
    };
    const movNome = {
      id: movimentacaoIdNome,
      descricaoRaw: "CRED PIX",
      remetenteDestinatario: "MARIA SILVA",
      origemExtracao: null,
      confiancaGlobal: 0,
      bloqueioExport: false,
      pessoaFisicaId: null,
      pessoaJuridicaId: null,
    };

    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    const insertFn = vi.fn().mockImplementation((table: unknown) => {
      if (table === matchEvidencia) {
        return { values: insertValues };
      }
      return { values: vi.fn() };
    });

    const { updateFn } = buildUpdateEcho(movNome);

    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) =>
          mockFromTable(table, {
            movRows: [movNome],
            pfRows: [existingPf],
            pjRows: [],
          }),
      }),
      delete: deleteFn,
      insert: insertFn,
      update: updateFn,
    };

    const result = await applyDeterministicMatch(
      db as never,
      movimentacaoIdNome,
    );
    expect(result.pessoaFisicaId).toBe(existingPf.id);
    expect(result.status).toBe("PENDENTE_REVISAO");
    expect(result.status).not.toBe("CONFIRMADO");
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
