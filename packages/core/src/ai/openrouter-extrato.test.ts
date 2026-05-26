import { describe, expect, it, vi } from "vitest";

import {
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
} from "./openrouter";

const SAMPLE_EXTRATO = {
  transacoes: [
    {
      data: "2025-03-01",
      valor: 100.5,
      direcao: "SAIDA",
      descricao: "PIX enviado",
    },
    {
      data: "2025-03-02",
      valor: 2500.0,
      direcao: "ENTRADA",
      descricao: "Salário",
      cpf: "12345678909",
    },
  ],
};

function mockOpenRouterResponse(payload: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  };
}

describe("extrato extraction (OpenRouter)", () => {
  it("extractTransactionsFromPdfText returns items; body is text-only", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));

    const result = await extractTransactionsFromPdfText("Saldo inicial ... linhas ...", {
      fetch: mockFetch,
      apiKey: "test-key",
    });

    expect(result.transacoes).toHaveLength(2);
    expect(result.transacoes[0]).toMatchObject({
      data: "2025-03-01",
      valor: 100.5,
      direcao: "SAIDA",
      descricao: "PIX enviado",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
      response_format: { json_schema: { name: string } };
    };

    expect(body.response_format.json_schema.name).toBe("extrato_transacoes");

    const userMsg = body.messages.find((m) => m.role === "user");
    expect(typeof userMsg?.content).toBe("string");
    expect(JSON.stringify(body)).not.toContain('"type":"file"');
  });

  it("extractTransactionsFromPdfFile includes file attachment", async () => {
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));
    const buf = Buffer.from("%PDF-1.4 demo");

    const result = await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "test-key",
      filename: "extrato.pdf",
    });

    expect(result.transacoes).toHaveLength(2);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    const userMsg = body.messages.find((m) => m.role === "user");
    expect(Array.isArray(userMsg?.content)).toBe(true);
    const parts = userMsg?.content as Array<{ type?: string }>;
    expect(parts.some((p) => p.type === "file")).toBe(true);
    expect(parts.some((p) => p.type === "text")).toBe(true);
  });
});
