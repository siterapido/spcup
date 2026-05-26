import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ai/openrouter", () => ({
  extractStructuredFromPdf: vi.fn(),
  extractTransactionsFromPdfText: vi.fn(),
  extractTransactionsFromPdfFile: vi.fn(),
}));

vi.mock("./pdf-text", () => ({
  extractPdfText: vi.fn(),
}));

vi.mock("./ofx", () => ({
  persistTransactions: vi.fn(),
  computeHashMovimento: vi.fn(),
  parseOfx: vi.fn(),
}));

vi.mock("../match/apply-ai", () => ({
  applyAiMatchToMovimentacao: vi.fn(),
}));

import {
  extractStructuredFromPdf,
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
} from "../ai/openrouter";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { extractPdfText } from "./pdf-text";
import { persistTransactions } from "./ofx";
import { MOVIMENTACAO_STATUS, TIPO_PRESTADOR } from "./types";

const PRESTADOR_SP = {
  cnpjPrestador: "14679407000100",
  tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
};
import {
  ingestPdf,
  ingestPdfExtrato,
  rowFromExtraction,
  rowsFromExtratoTransactions,
} from "./pdf";

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

describe("rowsFromExtratoTransactions", () => {
  it("keeps rows with valid CPF; nome-only lines become rows for match por nome", () => {
    const extraction = {
      transacoes: [
        {
          data: "2025-06-01",
          valor: 100,
          direcao: "ENTRADA",
          descricao: "Deposito",
          cpf: "39053344705",
        },
        {
          data: "2025-06-02",
          valor: 50,
          direcao: "SAIDA",
          descricao: "Sem doc",
        },
      ],
    };

    const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(extraction);
    expect(rows).toHaveLength(2);
    expect(linhasIgnoradasSemDoc).toBe(0);
    expect(rows[0]!.valor).toBe("100.00");
    expect(rows[0]!.descricaoRaw).toBe("Deposito CPF 39053344705");
    expect(rows[0]!.direcao).toBe("ENTRADA");
    expect(rows[1]!.descricaoRaw).toBe("Sem doc");
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

describe("ingestPdfExtrato", () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tmpDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("uses extractTransactionsFromPdfText when PDF has enough text", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "spc-up-ingest-extrato-"));
    tmpDirs.push(dir);
    const pdfPath = path.join(dir, "extrato.pdf");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4 extrato"));

    const statementText = "x".repeat(250);

    vi.mocked(extractPdfText).mockResolvedValue({
      text: statementText,
      numpages: 1,
      hasEnoughText: true,
    });

    const extratoAi = {
      transacoes: [
        {
          data: "2025-06-01",
          valor: 30,
          direcao: "SAIDA",
          descricao: "TED",
          cpf: "39053344705",
        },
      ],
    };

    const draftMov = {
      id: "mov-ex-1",
      dataMovimento: "2025-06-01",
      valor: "30.00",
      direcao: "SAIDA",
      descricaoRaw: "TED CPF 39053344705",
      arquivoIngestaoId: "arquivo-ex-1",
      status: MOVIMENTACAO_STATUS.RASCUNHO,
      pessoaFisicaId: null,
    };

    const matchedMov = {
      ...draftMov,
      status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
      pessoaFisicaId: "pf-2",
    };

    vi.mocked(extractTransactionsFromPdfText).mockResolvedValue(extratoAi);
    vi.mocked(persistTransactions).mockResolvedValue([draftMov] as never);
    vi.mocked(applyAiMatchToMovimentacao).mockResolvedValue(matchedMov as never);

    const result = await ingestPdfExtrato(
      {} as never,
      "SP",
      2025,
      "arquivo-ex-1",
      pdfPath,
      PRESTADOR_SP,
    );

    expect(result.movimentacoes).toHaveLength(1);
    expect(result.linhasIgnoradasSemDoc).toBe(0);
    expect(extractTransactionsFromPdfText).toHaveBeenCalledWith(statementText, {
      filename: "extrato.pdf",
    });
    expect(extractTransactionsFromPdfFile).not.toHaveBeenCalled();
    expect(persistTransactions).toHaveBeenCalledWith(
      expect.anything(),
      "SP",
      2025,
      "arquivo-ex-1",
      expect.arrayContaining([
        expect.objectContaining({
          valor: "30.00",
          descricaoRaw: "TED CPF 39053344705",
        }),
      ]),
      PRESTADOR_SP,
    );
  });
});
