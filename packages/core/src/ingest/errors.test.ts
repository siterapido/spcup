import { describe, expect, it } from "vitest";

import { classifyIngestError } from "./errors";

describe("classifyIngestError", () => {
  it("maps missing OpenRouter key", () => {
    const r = classifyIngestError(new Error("OPENROUTER_API_KEY is not configured"));
    expect(r.codigo).toBe("OPENROUTER_NAO_CONFIGURADO");
    expect(r.mensagem).toMatch(/não está configurada/i);
  });

  it("maps page limit", () => {
    const r = classifyIngestError(
      new Error("Extrato com mais de 3 páginas; divida o arquivo"),
    );
    expect(r.codigo).toBe("PDF_MUITAS_PAGINAS");
  });

  it("maps OpenRouter HTTP", () => {
    const r = classifyIngestError(new Error("OpenRouter HTTP 502"));
    expect(r.codigo).toBe("OPENROUTER_FALHA");
  });

  it("maps invalid PDF", () => {
    const r = classifyIngestError(new Error("Invalid PDF structure"));
    expect(r.codigo).toBe("PDF_INVALIDO");
  });

  it("falls back to unknown", () => {
    const r = classifyIngestError(new Error("something weird"));
    expect(r.codigo).toBe("INGESTAO_DESCONHECIDA");
  });
});
