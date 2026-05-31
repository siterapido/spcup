import { describe, expect, it, vi } from "vitest";

const processarPaginaMock = vi.fn();
const consolidateMock = vi.fn();

vi.mock("../ingest/pdf-pagina", () => ({
  processarPaginaPdfExtrato: (...args: unknown[]) => processarPaginaMock(...args),
}));

vi.mock("../consolidacao/run", () => ({
  consolidateSession: (...args: unknown[]) => consolidateMock(...args),
}));

vi.mock("./sessao", () => ({
  getSessao: vi.fn(async () => ({
    id: "sess-1",
    uf: "BA",
    exercicio: 2025,
    consolidarExtratos: true,
    diretorioEstadual: { cnpjPrestador: "23738595000182" },
    diretorioMunicipal: null,
    tipoPrestador: "ESTADUAL",
  })),
  prestadorFromSessao: vi.fn(() => ({
    cnpjPrestador: "23738595000182",
    tipoPrestador: "ESTADUAL",
    sessaoPrestacaoId: "sess-1",
  })),
}));

import { processSessaoPdfArquivos } from "./process-sessao";

describe("processSessaoPdfArquivos", () => {
  it("processes all pages of pending PDFs and runs consolidation", async () => {
    processarPaginaMock.mockResolvedValue({
      pagina: 1,
      totalPaginas: 1,
      movimentacoes_criadas: 5,
      statusPagina: "OK",
      modo: "texto",
    });
    consolidateMock.mockResolvedValue({ skipped: false, eventos: 2 });

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
  });
});
