import { describe, expect, it } from "vitest";

import {
  type Evidence,
  computeConfidence,
  evaluateMovimentacao,
} from "./confidence";

describe("confidence", () => {
  it("caps score when conflict evidence is present", () => {
    const evidences: Evidence[] = [
      { tipo: "CPF_EXATO", peso: 0.45 },
      { tipo: "CONFLITO_CPF", peso: 0, cap: 0.4 },
    ];
    expect(computeConfidence(evidences)).toBe(0.4);
  });

  it("blocks export when SPCA data is missing", () => {
    const movimentacao = {
      confianca_global: 0,
      bloqueio_export: false,
      spca: null,
      evidencias: [],
    };

    const score = evaluateMovimentacao(movimentacao, [
      { tipo: "CPF_EXATO", peso: 0.45 },
    ]);

    expect(score).toBe(0.45);
    expect(movimentacao.confianca_global).toBe(0.45);
    expect(movimentacao.bloqueio_export).toBe(true);
  });

  it("unblocks export when SPCA data is complete", () => {
    const movimentacao = {
      confianca_global: 0,
      bloqueio_export: true,
      spca: {
        fonte_recurso: "FP",
        natureza_recurso: "0",
        tipo_origem_recurso: "PF",
      },
      evidencias: [],
    };

    evaluateMovimentacao(movimentacao, [
      { tipo: "CPF_EXATO", peso: 0.45 },
      { tipo: "VALOR_DATA", peso: 0.25 },
    ]);

    expect(movimentacao.confianca_global).toBe(0.7);
    expect(movimentacao.bloqueio_export).toBe(false);
  });
});
