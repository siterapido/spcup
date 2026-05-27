import { describe, expect, it } from "vitest";

import { classifyIngestError, IngestError } from "./errors";

describe("classifyIngestError", () => {
  it("maps missing OpenRouter key", () => {
    const r = classifyIngestError(new Error("OPENROUTER_API_KEY is not configured"));
    expect(r.codigo).toBe("OPENROUTER_NAO_CONFIGURADO");
    expect(r.mensagem).toMatch(/não está configurada/i);
  });

  it("maps page limit", () => {
    const r = classifyIngestError(
      new Error("Extrato com mais de 12 páginas; divida o arquivo."),
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

  it("maps vision failure", () => {
    const r = classifyIngestError(
      new Error("PDF sem texto suficiente e visão falhou"),
    );
    expect(r.codigo).toBe("PDF_SEM_TEXTO_E_VISAO_FALHOU");
    expect(r.causaTecnica).toMatch(/visão/i);
  });

  it("falls back to unknown with technical cause preserved", () => {
    const r = classifyIngestError(new Error("something weird"));
    expect(r.codigo).toBe("INGESTAO_DESCONHECIDA");
    expect(r.causaTecnica).toBe("something weird");
  });

  it("preserves IngestError detail (no re-classify from user message)", () => {
    const original = new IngestError({
      codigo: "OPENROUTER_FALHA",
      mensagem: "Não foi possível ler o extrato com IA. Tente novamente em alguns minutos.",
      causaTecnica: "OpenRouter HTTP 502: upstream",
    });
    const r = classifyIngestError(original);
    expect(r.codigo).toBe("OPENROUTER_FALHA");
    expect(r.causaTecnica).toBe("OpenRouter HTTP 502: upstream");
  });
});
