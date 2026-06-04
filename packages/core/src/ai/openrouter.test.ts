import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractStructuredFromPdf } from "./openrouter";

const SAMPLE_EXTRACTION = {
  cpf: "12345678909",
  nome: "Joao Silva",
  valor: 1000.0,
  data: "2025-03-15",
  direcao: "ENTRADA",
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

describe("extractStructuredFromPdf", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  async function writePdf(name = "comprovante.pdf"): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "spc-up-pdf-"));
    tmpDirs.push(dir);
    const pdfPath = path.join(dir, name);
    await writeFile(pdfPath, Buffer.from("%PDF-1.4 sample"));
    return pdfPath;
  }

  it("returns expected fields with json_schema payload", async () => {
    const pdfPath = await writePdf();
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRACTION));

    const result = await extractStructuredFromPdf(pdfPath, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
    });

    expect(result).toEqual(SAMPLE_EXTRACTION);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: { type: string };
    };
    expect(body.response_format.type).toBe("json_schema");
  });

  it("retries on HTTP error", async () => {
    const pdfPath = await writePdf();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      })
      .mockResolvedValueOnce(mockOpenRouterResponse(SAMPLE_EXTRACTION));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await extractStructuredFromPdf(pdfPath, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
      sleep,
    });

    expect(result).toEqual(SAMPLE_EXTRACTION);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("parses JSON wrapped in markdown fences", async () => {
    const pdfPath = await writePdf();
    const fenced = "```json\n" + JSON.stringify(SAMPLE_EXTRACTION) + "\n```";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: fenced } }],
      }),
    });

    const result = await extractStructuredFromPdf(pdfPath, {
      fetch: mockFetch,
      apiKey: "sk-or-v1-test-key",
    });

    expect(result).toEqual(SAMPLE_EXTRACTION);
  });

  it("requires api key", async () => {
    const pdfPath = await writePdf();
    const mockFetch = vi.fn();

    await expect(
      extractStructuredFromPdf(pdfPath, {
        fetch: mockFetch,
        apiKey: "",
      }),
    ).rejects.toThrow(/OPENROUTER_API_KEY/);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws error when DISABLE_OPENROUTER is true", async () => {
    const pdfPath = await writePdf();
    const mockFetch = vi.fn();
    process.env.DISABLE_OPENROUTER = "true";

    try {
      await expect(
        extractStructuredFromPdf(pdfPath, {
          fetch: mockFetch,
          apiKey: "sk-or-v1-test-key",
        })
      ).rejects.toThrow(/OpenRouter está desativado/);
    } finally {
      delete process.env.DISABLE_OPENROUTER;
    }
  });
});
