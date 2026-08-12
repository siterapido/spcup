import { describe, expect, it } from "vitest";
import {
  ResolveArquivoBaseError,
  resolveArquivoBaseId,
  type ArquivoIngestaoBaseCandidate,
} from "./resolve-arquivo-base";

const pix: ArquivoIngestaoBaseCandidate = {
  id: "pix-1",
  nome: "Extrato Jan PIX (1).pdf",
};
const total1: ArquivoIngestaoBaseCandidate = {
  id: "total-1",
  nome: "EXTRATO TOTAL JANEIRO.pdf",
};
const total2: ArquivoIngestaoBaseCandidate = {
  id: "total-2",
  nome: "EXTRATO TOTAL FEVEREIRO.pdf",
};

describe("resolveArquivoBaseId", () => {
  it("retorna null quando não há caixa_total", () => {
    expect(resolveArquivoBaseId([pix])).toBeNull();
    expect(resolveArquivoBaseId([])).toBeNull();
  });

  it("auto-seleciona único caixa_total", () => {
    expect(resolveArquivoBaseId([pix, total1])).toBe("total-1");
  });

  it("aceita explicitId igual ao único total", () => {
    expect(resolveArquivoBaseId([total1], undefined, "total-1")).toBe("total-1");
  });

  it("rejeita explicitId divergente com único total", () => {
    expect(() => resolveArquivoBaseId([total1], undefined, "outro-id")).toThrow(
      ResolveArquivoBaseError,
    );
  });

  it("exige explicitId com 2+ totais", () => {
    expect(() => resolveArquivoBaseId([total1, total2])).toThrow(ResolveArquivoBaseError);
    expect(() => resolveArquivoBaseId([total1, total2])).toThrow(
      /Selecione qual é o extrato base/,
    );
  });

  it("retorna explicitId válido entre 2+ totais", () => {
    expect(resolveArquivoBaseId([total1, total2, pix], undefined, "total-2")).toBe(
      "total-2",
    );
  });

  it("rejeita explicitId que não é total da sessão", () => {
    expect(() =>
      resolveArquivoBaseId([total1, total2], undefined, "pix-1"),
    ).toThrow(ResolveArquivoBaseError);
  });

  it("usa extratoModeloIds quando filename é ambíguo", () => {
    const ambiguo: ArquivoIngestaoBaseCandidate = {
      id: "arq-x",
      nome: "extrato-janeiro.pdf",
    };
    expect(
      resolveArquivoBaseId([ambiguo], { "arq-x": "caixa_total" }),
    ).toBe("arq-x");
  });

  it("extratoModeloIds prevalece sobre filename", () => {
    expect(
      resolveArquivoBaseId([pix], { "pix-1": "caixa_total" }),
    ).toBe("pix-1");
  });
});
