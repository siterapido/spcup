import { describe, expect, it } from "vitest";

import {
  applyMesmoValorRevisaoHumanaCap,
  isConsolidacaoAutoAprovavel,
} from "./auto";
import type { ConsolidacaoEventDraft } from "./types";

function draft(
  partial: Partial<ConsolidacaoEventDraft> & Pick<ConsolidacaoEventDraft, "valor" | "dataMovimento">,
): ConsolidacaoEventDraft {
  return {
    direcao: "ENTRADA",
    confianca: 0.8,
    justificativa: "teste",
    linhas: [],
    hipoteses: [],
    evidencias: [],
    origemAtributos: { versao: 1, dataMovimento: [], valor: [], direcao: [], pessoa: [], confianca: [] },
    ...partial,
  };
}

describe("applyMesmoValorRevisaoHumanaCap", () => {
  it("reduz confiança quando há duplicata de valor sem CPF forte", () => {
    const a = draft({
      valor: "10",
      dataMovimento: "2025-01-01",
      confianca: 0.85,
      pessoaFisicaId: "pf-1",
    });
    const b = draft({
      valor: "10",
      dataMovimento: "2025-01-01",
      confianca: 0.85,
      pessoaFisicaId: "pf-2",
    });
    applyMesmoValorRevisaoHumanaCap([a, b]);
    expect(a.confianca).toBeLessThanOrEqual(0.64);
    expect(b.confianca).toBeLessThanOrEqual(0.64);
  });

  it("mantém confiança alta com CPF forte em duplicata", () => {
    const a = draft({
      valor: "10",
      dataMovimento: "2025-01-01",
      confianca: 0.95,
      pessoaFisicaId: "pf-1",
    });
    const b = draft({
      valor: "10",
      dataMovimento: "2025-01-01",
      confianca: 0.55,
    });
    applyMesmoValorRevisaoHumanaCap([a, b]);
    expect(a.confianca).toBe(0.95);
    expect(b.confianca).toBeLessThanOrEqual(0.64);
  });
});

describe("isConsolidacaoAutoAprovavel", () => {
  it("exige pessoa e limiar", () => {
    expect(
      isConsolidacaoAutoAprovavel(
        draft({
          valor: "1",
          dataMovimento: "2025-01-01",
          confianca: 0.9,
          pessoaFisicaId: "pf",
          cadastroLinkTier: "ALTA",
        }),
        0.85,
      ),
    ).toBe(true);
    expect(
      isConsolidacaoAutoAprovavel(
        draft({ valor: "1", dataMovimento: "2025-01-01", confianca: 0.9 }),
        0.85,
      ),
    ).toBe(false);
    expect(
      isConsolidacaoAutoAprovavel(
        draft({
          valor: "1",
          dataMovimento: "2025-01-01",
          confianca: 0.7,
          pessoaFisicaId: "pf",
        }),
        0.85,
      ),
    ).toBe(false);
  });

  it("não aprova tier MEDIA mesmo com pessoa e limiar", () => {
    expect(
      isConsolidacaoAutoAprovavel(
        draft({
          valor: "1",
          dataMovimento: "2025-01-01",
          confianca: 0.9,
          pessoaFisicaId: "pf",
          cadastroLinkTier: "MEDIA",
        }),
        0.85,
      ),
    ).toBe(false);
  });
});
