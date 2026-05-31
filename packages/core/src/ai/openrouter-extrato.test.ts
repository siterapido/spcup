import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractFileOcrTextFromOpenRouterBody,
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  isKimiModel,
  parseExtratoValor,
  resolveExtratoModel,
  resolvePdfTimeoutMs,
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

describe("isKimiModel", () => {
  it("detects kimi slugs", () => {
    expect(isKimiModel("moonshotai/kimi-k2.6")).toBe(true);
    expect(isKimiModel("google/gemini-2.5-flash")).toBe(false);
  });
});

describe("parseExtratoValor", () => {
  it("parses Brazilian decimal strings", () => {
    expect(parseExtratoValor("10,00")).toBe(10);
    expect(parseExtratoValor("1.234,56")).toBe(1234.56);
    expect(parseExtratoValor(100.5)).toBe(100.5);
  });
});

describe("extractFileOcrTextFromOpenRouterBody", () => {
  it("joins text blocks from file annotations", () => {
    const text = extractFileOcrTextFromOpenRouterBody({
      choices: [
        {
          message: {
            content: '{"transacoes":[]}',
            annotations: [
              {
                type: "file",
                file: {
                  content: [
                    { type: "text", text: '<file name="p1.pdf">' },
                    { type: "text", text: "Extrato Pix\nGABRIEL REIS DA SILVA" },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    expect(text).toContain("Extrato Pix");
    expect(text).not.toContain("<file name=");
  });
});

describe("resolvePdfTimeoutMs", () => {
  const prev = process.env.OPENROUTER_PDF_TIMEOUT_MS;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENROUTER_PDF_TIMEOUT_MS;
    } else {
      process.env.OPENROUTER_PDF_TIMEOUT_MS = prev;
    }
  });

  it("defaults to 180s for PDF vision", () => {
    delete process.env.OPENROUTER_PDF_TIMEOUT_MS;
    expect(resolvePdfTimeoutMs()).toBe(180_000);
  });
});

describe("resolveExtratoModel", () => {
  const prevPdf = process.env.OPENROUTER_PDF_MODEL;
  const prevModel = process.env.OPENROUTER_MODEL;

  afterEach(() => {
    if (prevPdf === undefined) {
      delete process.env.OPENROUTER_PDF_MODEL;
    } else {
      process.env.OPENROUTER_PDF_MODEL = prevPdf;
    }
    if (prevModel === undefined) {
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = prevModel;
    }
  });

  it("does not fall back to OPENROUTER_MODEL", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
    expect(resolveExtratoModel()).toBe("google/gemini-3.5-flash");
  });

  it("uses OPENROUTER_PDF_MODEL when set", () => {
    process.env.OPENROUTER_PDF_MODEL = "google/gemini-2.5-pro";
    expect(resolveExtratoModel()).toBe("google/gemini-2.5-pro");
  });
});

describe("extrato extraction (OpenRouter)", () => {
  const prevCache = process.env.OPENROUTER_CACHE;

  afterEach(() => {
    if (prevCache === undefined) {
      delete process.env.OPENROUTER_CACHE;
    } else {
      process.env.OPENROUTER_CACHE = prevCache;
    }
  });

  it("extractTransactionsFromPdfText returns items; body is text-only", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));

    const result = await extractTransactionsFromPdfText("Saldo inicial ... linhas ...", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      model: "google/gemini-2.5-flash",
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

  it("accepts bare JSON array in markdown (model ignores schema wrapper)", async () => {
    const arrayOnly =
      "Here are the transactions:\n```json\n" +
      JSON.stringify(SAMPLE_EXTRATO.transacoes) +
      "\n```";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: arrayOnly } }],
      }),
    });

    const result = await extractTransactionsFromPdfText("extrato lines", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
    });

    expect(result.transacoes).toHaveLength(2);
  });

  it("extractTransactionsFromPdfFile includes file attachment", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));
    const buf = Buffer.from("%PDF-1.4 demo");

    const result = await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
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

  it("falls back to text extraction when Kimi returns empty JSON but OCR annotations exist", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const ocrBody = {
      choices: [
        {
          message: {
            content: '{"transacoes":[]}',
            annotations: [
              {
                type: "file",
                file: {
                  content: [
                    {
                      type: "text",
                      text: "Extrato Pix\n".repeat(30),
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };
    const textBody = {
      choices: [{ message: { content: JSON.stringify(SAMPLE_EXTRATO) } }],
    };

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ocrBody,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => textBody,
      });

    const buf = Buffer.from("%PDF-1.4 demo");
    const result = await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      filename: "extrato.pdf",
      model: "moonshotai/kimi-k2.6",
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.transacoes).toHaveLength(2);
    const firstBody = JSON.parse(String(mockFetch.mock.calls[0]![1]!.body)) as {
      plugins?: unknown;
    };
    expect(firstBody.plugins).toEqual([
      { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    ]);
  });

  it("extrato json_schema lists every property in required (Azure strict)", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));

    await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      model: "google/gemini-3.5-flash",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: {
        json_schema: {
          schema: {
            properties: {
              transacoes: { items: { properties: Record<string, unknown>; required: string[] } };
            };
          };
        };
      };
    };
    const item = body.response_format.json_schema.schema.properties.transacoes.items;
    const propKeys = Object.keys(item.properties).sort();
    expect([...item.required].sort()).toEqual(propKeys);
    expect(propKeys).toContain("cred_dev");
  });

  it("Gemini PDF extrato uses json_schema and no plugins", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));
    const buf = Buffer.from("%PDF-1.4 demo");

    await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      filename: "extrato.pdf",
      model: "google/gemini-3.5-flash",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: { type: string; json_schema?: { name: string } };
      plugins?: unknown;
    };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema?.name).toBe("extrato_transacoes");
    expect(body.plugins).toBeUndefined();
  });

  it("copies long descricao to nome when nome missing", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(
      mockOpenRouterResponse({
        transacoes: [
          {
            data: "2025-01-02",
            valor: 10,
            direcao: "ENTRADA",
            descricao: "GABRIEL REIS DA SILVA",
          },
        ],
      }),
    );

    const result = await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      model: "google/gemini-3.5-flash",
    });

    expect(result.transacoes[0]?.nome).toBe("GABRIEL REIS DA SILVA");
  });

  it("infers cred_dev from short bank codes in descricao", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(
      mockOpenRouterResponse({
        transacoes: [
          {
            data: "2025-01-02",
            valor: 10,
            direcao: "ENTRADA",
            descricao: "CRED TEV",
          },
        ],
      }),
    );

    const result = await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      model: "google/gemini-3.5-flash",
    });

    expect(result.transacoes[0]?.cred_dev).toBe("CRED TEV");
    expect(result.transacoes[0]?.nome).toBeUndefined();
  });

  it("does not copy short bank codes to nome", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(
      mockOpenRouterResponse({
        transacoes: [
          {
            data: "2025-01-02",
            valor: 10,
            direcao: "ENTRADA",
            descricao: "CRED TEV",
          },
        ],
      }),
    );

    const result = await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      model: "google/gemini-3.5-flash",
    });

    expect(result.transacoes[0]?.nome).toBeUndefined();
  });

  it("uses json_object response_format for Kimi PDF extrato", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));
    const buf = Buffer.from("%PDF-1.4 demo");

    await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      filename: "extrato.pdf",
      model: "moonshotai/kimi-k2.6",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
      plugins?: Array<{ id: string; pdf: { engine: string } }>;
    };
    expect(body.response_format.type).toBe("json_object");
    expect(body.messages[0]?.content).toMatch(/transacoes/i);
    expect(body.plugins).toEqual([
      { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    ]);
  });
});
