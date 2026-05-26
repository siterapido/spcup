import { describe, expect, it, vi } from "vitest";

import { evaluateMovimentacaoWithAi } from "./ai";

describe("evaluateMovimentacaoWithAi", () => {
  it("maps AI response to structured result", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                mesmo_evento: true,
                confianca: 0.91,
                justificativa: "CPF e valor conferem; data D+1 após feriado.",
                pessoa_tipo: "PF",
                pessoa_documento: "12345678901",
                campos_faltantes: ["fonte_recurso"],
                evidencias: [{ tipo: "IA_DATA_TOLERANCIA", detalhe: "Carnaval" }],
              }),
            },
          },
        ],
      }),
    });

    const out = await evaluateMovimentacaoWithAi(
      {
        valor: "100.00",
        dataMovimento: "2025-03-01",
        direcao: "ENTRADA",
        descricaoRaw: "PIX Joao",
        uf: "SP",
        exercicio: 2025,
        tipoPrestador: "ESTADUAL",
        candidatos: [{ tipo: "PF", documento: "12345678901", nome: "Joao" }],
      },
      { fetch: mockFetch, apiKey: "test-key" },
    );

    expect(out.confianca).toBe(0.91);
    expect(out.campos_faltantes).toContain("fonte_recurso");
    expect(out.pessoa_tipo).toBe("PF");
  });
});
