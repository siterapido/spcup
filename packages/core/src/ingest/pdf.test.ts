import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai/openrouter", () => ({
  extractStructuredFromPdf: vi.fn(),
}));

vi.mock("./ofx", () => ({
  persistTransactions: vi.fn(),
  computeHashMovimento: vi.fn(),
  parseOfx: vi.fn(),
}));

vi.mock("../match/apply-ai", () => ({
  applyAiMatchToMovimentacao: vi.fn(),
}));

import { extractStructuredFromPdf } from "../ai/openrouter";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { persistTransactions } from "./ofx";
import { MOVIMENTACAO_STATUS, TIPO_PRESTADOR } from "./types";

const PRESTADOR_SP = {
  cnpjPrestador: "14679407000100",
  tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
};
import { ingestPdf, rowFromExtraction } from "./pdf";

const SAMPLE_EXTRACTION = {
  cpf: "12345678909",
  nome: "Joao Silva",
  valor: 1000.0,
  data: "2025-03-15",
  direcao: "ENTRADA",
};

describe("rowFromExtraction", () => {
  it("maps extraction to ingest row", () => {
    const row = rowFromExtraction(SAMPLE_EXTRACTION);
    expect(row.dataMovimento.toISOString().slice(0, 10)).toBe("2025-03-15");
    expect(row.valor).toBe("1000.00");
    expect(row.direcao).toBe("ENTRADA");
    expect(row.descricaoRaw).toContain("12345678909");
    expect(row.nrExtratoBancario).toBeNull();
  });
});

describe("ingestPdf", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("persists and applies match", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "spc-up-ingest-pdf-"));
    tmpDirs.push(dir);
    const pdfPath = path.join(dir, "comprovante.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4 sample"));

    const draftMov = {
      id: "mov-1",
      dataMovimento: "2025-03-15",
      valor: "1000.00",
      direcao: "ENTRADA",
      descricaoRaw: "Joao Silva CPF 12345678909",
      arquivoIngestaoId: "arquivo-1",
      status: MOVIMENTACAO_STATUS.RASCUNHO,
      pessoaFisicaId: null,
    };

    const matchedMov = {
      ...draftMov,
      status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
      pessoaFisicaId: "pf-1",
    };

    vi.mocked(extractStructuredFromPdf).mockResolvedValue(SAMPLE_EXTRACTION);
    vi.mocked(persistTransactions).mockResolvedValue([draftMov] as never);
    vi.mocked(applyAiMatchToMovimentacao).mockResolvedValue(matchedMov as never);

    const movimentacoes = await ingestPdf(
      {} as never,
      "SP",
      2025,
      "arquivo-1",
      pdfPath,
      PRESTADOR_SP,
    );

    expect(movimentacoes).toHaveLength(1);
    expect(movimentacoes[0]).toMatchObject({
      dataMovimento: "2025-03-15",
      valor: "1000.00",
      direcao: "ENTRADA",
      arquivoIngestaoId: "arquivo-1",
      status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
      pessoaFisicaId: "pf-1",
    });
    expect(movimentacoes[0]?.descricaoRaw).toContain("12345678909");
    expect(extractStructuredFromPdf).toHaveBeenCalledWith(pdfPath);
    expect(persistTransactions).toHaveBeenCalledWith(
      expect.anything(),
      "SP",
      2025,
      "arquivo-1",
      expect.arrayContaining([
        expect.objectContaining({
          valor: "1000.00",
          direcao: "ENTRADA",
        }),
      ]),
      PRESTADOR_SP,
    );
    expect(applyAiMatchToMovimentacao).toHaveBeenCalledWith(expect.anything(), "mov-1");
  });
});
