import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock AI module functions before importing dualExtractPage
vi.mock("../ai/openrouter", () => {
  return {
    extractTransactionsFromPdfText: vi.fn(),
    extractTransactionsFromImagePng: vi.fn(),
    extractTransactionsFromPdfFile: vi.fn(),
    scoreExtratoLinhas: vi.fn(),
    resolveExtratoModel: vi.fn().mockReturnValue("google/gemini-3.5-flash"),
    resolveSecondaryExtratoModel: vi.fn().mockReturnValue(null),
    resolveReviewerExtratoModel: vi.fn().mockReturnValue("google/gemini-2.5-pro"),
    resolveScoreThreshold: () => 80,
    parseExtratoValor: (val: any) => Number(val),
  };
});

vi.mock("../ai/model-profile", () => {
  return {
    resolveModelProfile: (model: string) => {
      return {
        slug: model,
        responseFormat: "json_schema",
        pdfBatching: "gemini_native",
        pdfPlugins: null,
        ocrTextFallback: false,
        extratoPromptVariant: "gemini",
      };
    },
  };
});

import { dualExtractPage } from "./dual-extract";
import {
  extractTransactionsFromPdfText,
  extractTransactionsFromImagePng,
  extractTransactionsFromPdfFile,
  scoreExtratoLinhas,
  resolveSecondaryExtratoModel,
} from "../ai/openrouter";

describe("dualExtractPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("performs single model extraction and reviewer scoring when secondaryModel is null", async () => {
    vi.mocked(resolveSecondaryExtratoModel).mockReturnValue(null);

    vi.mocked(extractTransactionsFromPdfText).mockResolvedValue({
      transacoes: [
        {
          data: "2025-01-15",
          valor: 100.0,
          direcao: "ENTRADA",
          descricao: "Transferencia Recebida",
          cred_dev: "TED",
          cpf: "12345678909",
          cnpj: null,
          nome: "Joao Silva",
          pagina: 1,
          indice_linha: 1,
          bbox: { x: 0, y: 0, w: 1, h: 0.1 },
        },
      ],
    });

    vi.mocked(scoreExtratoLinhas).mockResolvedValue([
      { score: 95, motivo: "Valid transaction" },
    ]);

    const result = await dualExtractPage({
      pageBuffer: Buffer.from("dummy page"),
      text: "Transferencia Recebida",
      hasEnoughText: true,
      filename: "extrato.pdf",
      page1Based: 1,
    });

    expect(extractTransactionsFromPdfText).toHaveBeenCalledTimes(1);
    expect(scoreExtratoLinhas).toHaveBeenCalledTimes(1);
    expect(result.statusPagina).toBe("OK");
    expect(result.aceitas).toHaveLength(1);
    expect(result.aceitas[0]?.score).toBe(95);
    expect(result.aceitas[0]?.modeloOrigem).toBe("revisor");
  });

  it("performs whole-PDF extraction when fullBuffer is provided and gemini_native batching is used", async () => {
    vi.mocked(resolveSecondaryExtratoModel).mockReturnValue(null);

    // Mock full PDF returns transactions for page 1 and page 2
    vi.mocked(extractTransactionsFromPdfFile).mockResolvedValue({
      transacoes: [
        {
          data: "2025-01-15",
          valor: 100.0,
          direcao: "ENTRADA",
          descricao: "TX Page 1",
          cred_dev: "TED",
          cpf: "12345678909",
          cnpj: null,
          nome: "Joao Silva",
          pagina: 1,
          indice_linha: 1,
          bbox: { x: 0, y: 0, w: 1, h: 0.1 },
        },
        {
          data: "2025-01-16",
          valor: 200.0,
          direcao: "SAIDA",
          descricao: "TX Page 2",
          cred_dev: "TED",
          cpf: null,
          cnpj: "12345678000199",
          nome: "Empresa Ltda",
          pagina: 2,
          indice_linha: 1,
          bbox: { x: 0, y: 0, w: 1, h: 0.1 },
        },
      ],
    });

    vi.mocked(scoreExtratoLinhas).mockResolvedValue([
      { score: 90, motivo: "Valid" },
    ]);

    // Process page 2
    const result = await dualExtractPage({
      pageBuffer: Buffer.from("dummy page 2"),
      text: "TX Page 2",
      hasEnoughText: true,
      filename: "extrato.pdf",
      page1Based: 2,
      fullBuffer: Buffer.from("dummy full PDF"),
    });

    expect(extractTransactionsFromPdfFile).toHaveBeenCalledTimes(1);
    expect(extractTransactionsFromPdfText).not.toHaveBeenCalled();
    expect(scoreExtratoLinhas).toHaveBeenCalledTimes(1);

    // Should only contain page 2 transaction
    expect(result.aceitas).toHaveLength(1);
    expect(result.aceitas[0]?.item.descricao).toBe("TX Page 2");
  });
});
