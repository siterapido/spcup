// packages/core/src/planilha/status.test.ts
import { describe, expect, it } from "vitest";
import { deriveLinhaStatus, isLinhaPronta, buildResumo } from "./status";
import type { PlanilhaLinha } from "./types";

function linha(partial: Partial<PlanilhaLinha>): PlanilhaLinha {
  return {
    id: "1",
    fonte: "consolidacao",
    dataMovimento: "2025-01-15",
    valor: "100.00",
    direcao: "ENTRADA",
    descricao: "TESTE",
    confianca: 0.9,
    status: "pendente",
    pessoa: null,
    origens: [],
    eventoStatus: "PENDENTE",
    extracaoDuvidosa: false,
    ...partial,
  };
}

describe("isLinhaPronta", () => {
  it("false sem pessoa", () => {
    expect(isLinhaPronta(linha({ pessoa: null, confianca: 0.9 }))).toBe(false);
  });

  it("false com confianca abaixo de 0.6", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          confianca: 0.5,
          status: "pendente",
        }),
      ),
    ).toBe(false);
  });

  it("false quando extracaoDuvidosa true mesmo status pendente", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          confianca: 0.9,
          status: "pendente",
          extracaoDuvidosa: true,
        }),
      ),
    ).toBe(false);
  });

  it("false com merge_pendente", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          status: "merge_pendente",
        }),
      ),
    ).toBe(false);
  });

  it("true com pessoa e confianca >= 0.6", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          confianca: 0.65,
          status: "pronta",
        }),
      ),
    ).toBe(true);
  });
});

describe("deriveLinhaStatus", () => {
  it("merge_pendente quando evento PENDENTE com 2+ origens", () => {
    expect(
      deriveLinhaStatus({
        eventoStatus: "PENDENTE",
        origemCount: 2,
        pessoa: null,
        confianca: 0.8,
        extracaoDuvidosa: false,
      }),
    ).toBe("merge_pendente");
  });

  it("extracao_duvidosa tem prioridade", () => {
    expect(
      deriveLinhaStatus({
        eventoStatus: "PENDENTE",
        origemCount: 1,
        pessoa: null,
        confianca: 0.4,
        extracaoDuvidosa: true,
      }),
    ).toBe("extracao_duvidosa");
  });
});

describe("buildResumo", () => {
  it("conta prontas e exportavel", () => {
    const linhas = [
      linha({
        status: "pronta",
        pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
      }),
      linha({ status: "pendente", pessoa: null }),
    ];
    const resumo = buildResumo(linhas, false);
    expect(resumo.total).toBe(2);
    expect(resumo.prontas).toBe(1);
    expect(resumo.exportavel).toBe(false);
  });
});
