import { describe, expect, it, vi } from "vitest";

vi.mock("./sessao", () => ({
  getSessao: vi.fn(),
}));

vi.mock("../consolidacao/queries", () => ({
  listConsolidacaoForSessao: vi.fn(),
}));

import { listConsolidacaoForSessao } from "../consolidacao/queries";
import { getPrestacaoCliStatus } from "./cli-status";
import { getSessao } from "./sessao";

function mockSelectCount(value: number, key = "value") {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ [key]: value }]),
    }),
  };
}

describe("getPrestacaoCliStatus", () => {
  it("aggregates sessão, arquivos, contagens e paths", async () => {
    vi.mocked(getSessao).mockResolvedValue({
      id: "sess-1",
      uf: "BA",
      exercicio: 2025,
      status: "ABERTA",
      consolidarExtratos: true,
      diretorioEstadual: { cnpjPrestador: "23738595000182" },
      diretorioMunicipal: null,
      tipoPrestador: "ESTADUAL",
    } as never);

    vi.mocked(listConsolidacaoForSessao).mockResolvedValue({
      eventos: [{ id: "ev-1" }, { id: "ev-2" }] as never,
      pdfCount: 2,
      cadastroAlerta: false,
    });

    const selectMock = vi
      .fn()
      .mockReturnValueOnce(mockSelectCount(12))
      .mockReturnValueOnce(mockSelectCount(3))
      .mockReturnValueOnce(mockSelectCount(15, "total"))
      .mockReturnValueOnce(mockSelectCount(7, "pendentes"));

    const db = {
      query: {
        arquivoIngestao: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "arq-ofx",
              nomeArquivo: "lanc.ofx",
              status: "CONCLUIDO",
            },
            {
              id: "arq-pdf",
              nomeArquivo: "extrato.pdf",
              status: "PENDENTE",
            },
          ]),
        },
      },
      select: selectMock,
    } as never;

    const status = await getPrestacaoCliStatus(db, "sess-1");

    expect(status.sessaoId).toBe("sess-1");
    expect(status.uf).toBe("BA");
    expect(status.exercicio).toBe(2025);
    expect(status.status).toBe("ABERTA");
    expect(status.consolidarExtratos).toBe(true);
    expect(status.arquivos).toEqual([
      { id: "arq-ofx", nome: "lanc.ofx", status: "CONCLUIDO", movimentacoes: 12 },
      { id: "arq-pdf", nome: "extrato.pdf", status: "PENDENTE", movimentacoes: 3 },
    ]);
    expect(status.movimentacoesTotal).toBe(15);
    expect(status.movimentacoesPendentes).toBe(7);
    expect(status.pdfPendentes).toBe(1);
    expect(status.consolidacaoEventos).toBe(2);
    expect(status.kanbanPath).toBe("/prestacao/sess-1/kanban");
    expect(status.consolidacaoPath).toBe("/prestacao/sess-1/consolidacao");
  });

  it("throws when sessão is missing", async () => {
    vi.mocked(getSessao).mockResolvedValue(undefined);

    const db = {
      query: { arquivoIngestao: { findMany: vi.fn() } },
      select: vi.fn(),
    } as never;

    await expect(getPrestacaoCliStatus(db, "missing")).rejects.toThrow(
      "Sessão não encontrada",
    );
  });
});
