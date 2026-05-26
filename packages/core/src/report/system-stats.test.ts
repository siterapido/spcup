import { describe, expect, it } from "vitest";

import type { SystemStats } from "./system-stats";

describe("SystemStats shape", () => {
  it("documents expected global and scoped keys", () => {
    const sample = {
      uf: "SP",
      exercicio: 2025,
      global: {
        movimentacoesPorStatus: { RASCUNHO: 1 },
        movimentacoesBloqueadas: 0,
        confiancaFaixas: { abaixo60: 0, entre60e85: 1, acima85: 2 },
        arquivosPorStatus: { OK: 3 },
        conflitosPendentes: 0,
        pessoasPf: 10,
        pessoasPj: 5,
        pessoasStub: 2,
        sessoesAbertas: 1,
        diretoriosPlaceholder: 27,
      },
      scoped: {
        movimentacoesPorStatus: {},
        movimentacoesBloqueadas: 0,
        confiancaFaixas: { abaixo60: 0, entre60e85: 0, acima85: 0 },
        arquivosPorStatus: {},
        exportavel: false,
      },
    } satisfies SystemStats;

    expect(sample.global.confiancaFaixas.acima85).toBe(2);
    expect(sample.scoped.exportavel).toBe(false);
  });
});
