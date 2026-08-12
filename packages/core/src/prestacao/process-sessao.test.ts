import { describe, expect, it, vi } from "vitest";

const processarPaginaMock = vi.fn();
const consolidateMock = vi.fn();
const processSessaoWithNotebookLmMock = vi.fn();

vi.mock("../ingest/pdf-pagina", () => ({
  processarPaginaPdfExtrato: (...args: unknown[]) => processarPaginaMock(...args),
}));

vi.mock("../consolidacao/run", () => ({
  consolidateSession: (...args: unknown[]) => consolidateMock(...args),
}));

vi.mock("./process-sessao-notebooklm", () => ({
  processSessaoWithNotebookLM: (...args: unknown[]) => processSessaoWithNotebookLmMock(...args),
}));

vi.mock("./resolve-arquivo-base", () => ({
  persistArquivoBaseOnProcessStart: vi.fn().mockResolvedValue(null),
}));

vi.mock("./sessao", () => ({
  getSessao: vi.fn(async () => ({
    id: "sess-1",
    uf: "BA",
    exercicio: 2025,
    consolidarExtratos: true,
    arquivoBaseIngestaoId: null,
    diretorioEstadual: { cnpjPrestador: "23738595000182" },
    diretorioMunicipal: null,
    tipoPrestador: "ESTADUAL",
  })),
  prestadorFromSessao: vi.fn(() => ({
    cnpjPrestador: "23738595000182",
    tipoPrestador: "ESTADUAL",
    sessaoPrestacaoId: "sess-1",
  })),
  persistArquivoBaseIngestaoId: vi.fn().mockResolvedValue(undefined),
}));

import { processSessaoPdfArquivos } from "./process-sessao";

describe("processSessaoPdfArquivos", () => {
  it("processes all pages of pending PDFs and runs consolidation", async () => {
    process.env.USE_NOTEBOOKLM = "false";
    processarPaginaMock.mockResolvedValue({
      pagina: 1,
      totalPaginas: 1,
      movimentacoes_criadas: 5,
      statusPagina: "OK",
      modo: "texto",
    });
    consolidateMock.mockResolvedValue({
      skipped: false,
      eventos: 2,
      autoAprovados: 1,
      paraRevisar: 1,
      limiarAutoAprovacao: 0.85,
    });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "arq-1",
            nomeArquivo: "extrato.pdf",
            status: "PENDENTE",
          },
        ]),
      }),
    });

    const db = { select: selectMock } as never;

    const result = await processSessaoPdfArquivos(db, "sess-1");

    expect(processarPaginaMock).toHaveBeenCalled();
    expect(consolidateMock).toHaveBeenCalledTimes(1);
    expect(consolidateMock).toHaveBeenCalledWith(db, "sess-1");
    expect(result.consolidacao).toMatchObject({ skipped: false, eventos: 2 });
    expect(result.movimentacoesTotal).toBe(5);
    expect(result.arquivos).toHaveLength(1);

    delete process.env.USE_NOTEBOOKLM;
  });

  it("should fall back to traditional OpenRouter pipeline if NotebookLM fails", async () => {
    process.env.USE_NOTEBOOKLM = "true";
    process.env.DISABLE_OPENROUTER = "true";

    processSessaoWithNotebookLmMock.mockRejectedValue(new Error("NotebookLM CLI Error"));
    processarPaginaMock.mockResolvedValue({
      pagina: 1,
      totalPaginas: 1,
      movimentacoes_criadas: 3,
      statusPagina: "OK",
      modo: "texto",
    });
    consolidateMock.mockResolvedValue({ skipped: true });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "arq-1",
            nomeArquivo: "extrato.pdf",
            status: "PENDENTE",
          },
        ]),
      }),
    });
    const db = { select: selectMock } as never;

    const result = await processSessaoPdfArquivos(db, "sess-1");

    expect(processSessaoWithNotebookLmMock).toHaveBeenCalled();
    expect(processarPaginaMock).toHaveBeenCalled();
    expect(result.movimentacoesTotal).toBe(3);
    expect(result.avisos).toContain(
      "NotebookLM falhou. Ativado fallback para OpenRouter. Erro original: NotebookLM CLI Error"
    );
    expect(process.env.DISABLE_OPENROUTER).toBe("true"); // original state is restored

    delete process.env.USE_NOTEBOOKLM;
    delete process.env.DISABLE_OPENROUTER;
  });
});
