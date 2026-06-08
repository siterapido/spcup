import { describe, expect, it } from "vitest";

import {
  mapMovimentacaoToAprovadaItem,
  maskPessoaDocumento,
  resolvePrestadorNome,
} from "./list";

describe("maskPessoaDocumento", () => {
  it("masks CPF", () => {
    expect(maskPessoaDocumento({ cpf: "12345678901" }, null)).toBe(
      "123.456.789-01",
    );
  });

  it("masks CNPJ", () => {
    expect(maskPessoaDocumento(null, { cnpj: "12345678000199" })).toBe(
      "12.345.678/0001-99",
    );
  });

  it("returns null without pessoa", () => {
    expect(maskPessoaDocumento(null, null)).toBeNull();
  });
});

describe("resolvePrestadorNome", () => {
  it("prefers estadual over municipal", () => {
    const estadual = new Map([["11111111000111", "UP Estadual"]]);
    const municipal = new Map([["11111111000111", "Município X"]]);
    expect(resolvePrestadorNome("11111111000111", estadual, municipal)).toBe(
      "UP Estadual",
    );
  });

  it("falls back to municipal", () => {
    const estadual = new Map<string, string>();
    const municipal = new Map([["22222222000122", "Município Y"]]);
    expect(resolvePrestadorNome("22222222000122", estadual, municipal)).toBe(
      "Município Y",
    );
  });

  it("returns null when unknown", () => {
    expect(resolvePrestadorNome("000", new Map(), new Map())).toBeNull();
  });
});

describe("mapMovimentacaoToAprovadaItem", () => {
  it("maps row fields", () => {
    const item = mapMovimentacaoToAprovadaItem(
      {
        id: "mov-1",
        uf: "SP",
        exercicio: 2025,
        dataMovimento: "2025-01-15",
        valor: "100.50",
        direcao: "ENTRADA",
        descricaoRaw: "PIX TESTE",
        credDev: "CRED PIX",
        status: "CONFIRMADO",
        confiancaGlobal: 0.9,
        cnpjPrestador: "12345678000199",
        sessaoPrestacaoId: "sess-1",
        pessoaFisica: { nome: "João", cpf: "12345678901" },
        pessoaJuridica: null,
        arquivoIngestao: { nomeArquivo: "extrato.pdf" },
      } as Parameters<typeof mapMovimentacaoToAprovadaItem>[0],
      "UP SP",
    );

    expect(item).toMatchObject({
      id: "mov-1",
      pessoa_nome: "João",
      pessoa_documento: "123.456.789-01",
      prestador_nome: "UP SP",
      nome_arquivo: "extrato.pdf",
      status: "CONFIRMADO",
    });
  });
});
