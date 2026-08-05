import { describe, expect, it, vi } from "vitest";

import {
  buildIngestaoResumo,
  countLinhasPlanilhaPorArquivo,
  readIngestaoMetadados,
  readLinhasIgnoradasSemDoc,
} from "./ingestao-resumo";
import type { PlanilhaLinha } from "./types";

function linha(partial: Partial<PlanilhaLinha>): PlanilhaLinha {
  return {
    id: "1",
    fonte: "movimentacao",
    dataMovimento: "2025-01-15",
    valor: "100.00",
    direcao: "ENTRADA",
    descricao: "TESTE",
    descricaoRaw: "TESTE",
    nrExtratoBancario: null,
    confianca: 0.9,
    status: "pendente",
    pessoa: null,
    remetenteDestinatario: null,
    origens: [],
    extracaoDuvidosa: false,
    extracaoConfirmada: false,
    camposExtracao: {},
    ...partial,
  };
}

describe("readIngestaoMetadados", () => {
  it("lê metadados NotebookLM com avisos e motor", () => {
    const meta = readIngestaoMetadados({
      motor: "notebooklm",
      transacoes_extraidas: 10,
      movimentacoes_persistidas: 8,
      linhas_ignoradas_sem_doc: 2,
      avisos_balance: ["Inconsistência de saldos no extrato"],
      processado_em: "2026-06-08T12:00:00.000Z",
    });

    expect(meta.motor).toBe("notebooklm");
    expect(meta.transacoesExtraidas).toBe(10);
    expect(meta.linhasIgnoradasSemDoc).toBe(2);
    expect(meta.avisosBalance).toEqual(["Inconsistência de saldos no extrato"]);
  });

  it("retorna defaults quando metadados ausentes", () => {
    expect(readIngestaoMetadados(null)).toEqual({
      linhasIgnoradasSemDoc: 0,
      avisosBalance: [],
      motor: null,
      transacoesExtraidas: null,
    });
  });
});

describe("readLinhasIgnoradasSemDoc", () => {
  it("retorna número quando presente em metadados", () => {
    expect(readLinhasIgnoradasSemDoc({ linhas_ignoradas_sem_doc: 3 })).toBe(3);
  });

  it("retorna 0 quando ausente ou inválido", () => {
    expect(readLinhasIgnoradasSemDoc(null)).toBe(0);
    expect(readLinhasIgnoradasSemDoc({ linhas_ignoradas_sem_doc: "x" })).toBe(0);
  });
});

describe("countLinhasPlanilhaPorArquivo", () => {
  it("conta linhas por arquivo via origens", () => {
    const linhas = [
      linha({
        id: "l1",
        origens: [
          {
            movimentacaoId: "m1",
            arquivoIngestaoId: "a1",
            nomeArquivo: "a.pdf",
            descricaoRaw: "x",
            nrExtratoBancario: null,
          },
        ],
      }),
      linha({
        id: "l2",
        origens: [
          {
            movimentacaoId: "m2",
            arquivoIngestaoId: "a1",
            nomeArquivo: "a.pdf",
            descricaoRaw: "y",
            nrExtratoBancario: null,
          },
          {
            movimentacaoId: "m3",
            arquivoIngestaoId: "a2",
            nomeArquivo: "b.pdf",
            descricaoRaw: "z",
            nrExtratoBancario: null,
          },
        ],
      }),
      linha({
        id: "l3",
        origens: [
          {
            movimentacaoId: "m4",
            nomeArquivo: null,
            descricaoRaw: "sem arquivo",
            nrExtratoBancario: null,
          },
        ],
      }),
    ];

    const counts = countLinhasPlanilhaPorArquivo(linhas);
    expect(counts.get("a1")).toBe(2);
    expect(counts.get("a2")).toBe(1);
    expect(counts.has("a3")).toBe(false);
  });
});

describe("buildIngestaoResumo", () => {
  it("monta resumo com arquivos, páginas e totais", async () => {
    const linhas = [
      linha({
        id: "l1",
        status: "merge_pendente",
        origens: [
          {
            movimentacaoId: "m1",
            arquivoIngestaoId: "arq-1",
            nomeArquivo: "extrato.pdf",
            descricaoRaw: "x",
            nrExtratoBancario: null,
          },
        ],
      }),
    ];

    const selectMock = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 32 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { arquivoIngestaoId: "arq-1", total: 32 },
            ]),
          }),
        }),
      });

    const db = {
      query: {
        arquivoIngestao: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "arq-1",
              nomeArquivo: "extrato.pdf",
              status: "CONCLUIDO",
              metadados: { linhas_ignoradas_sem_doc: 2 },
            },
          ]),
        },
        ingestaoPagina: {
          findMany: vi.fn().mockResolvedValue([
            {
              arquivoIngestaoId: "arq-1",
              pagina: 1,
              status: "OK",
              aceitas: 10,
              incertas: 0,
              motivo: null,
            },
            {
              arquivoIngestaoId: "arq-1",
              pagina: 2,
              status: "VERIFICAR",
              aceitas: 5,
              incertas: 3,
              motivo: "Baixa confiança",
            },
          ]),
        },
      },
      select: selectMock,
    };

    const resumo = await buildIngestaoResumo(
      db as never,
      "sessao-1",
      linhas,
      { mergePendente: 1 } as never,
    );

    expect(resumo.movimentacoesBrutas).toBe(32);
    expect(resumo.linhasPlanilha).toBe(1);
    expect(resumo.mergesPendentes).toBe(1);
    expect(resumo.arquivos).toHaveLength(1);

    const arq = resumo.arquivos[0]!;
    expect(arq.movimentacoesExtraidas).toBe(32);
    expect(arq.linhasPlanilha).toBe(1);
    expect(arq.linhasIgnoradasSemDoc).toBe(2);
    expect(arq.paginasVerificar).toBe(1);
    expect(arq.paginas).toHaveLength(2);
    expect(arq.paginas[1]?.status).toBe("VERIFICAR");
  });

  it("suporta sessão NotebookLM com metadados e ingestao_pagina sintética", async () => {
    const selectMock = vi
      .fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 5 }]),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { arquivoIngestaoId: "arq-nb", total: 5 },
            ]),
          }),
        }),
      });

    const db = {
      query: {
        arquivoIngestao: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "arq-nb",
              nomeArquivo: "notebook.pdf",
              status: "CONCLUIDO",
              metadados: {
                motor: "notebooklm",
                transacoes_extraidas: 6,
                linhas_ignoradas_sem_doc: 1,
                avisos_balance: ["Créditos divergentes"],
              },
            },
          ]),
        },
        ingestaoPagina: {
          findMany: vi.fn().mockResolvedValue([
            {
              arquivoIngestaoId: "arq-nb",
              pagina: 1,
              status: "OK",
              aceitas: 5,
              incertas: 0,
              motivo: "NotebookLM — arquivo inteiro",
            },
          ]),
        },
      },
      select: selectMock,
    };

    const resumo = await buildIngestaoResumo(db as never, "sessao-nb", []);

    const arq = resumo.arquivos[0]!;
    expect(arq.movimentacoesExtraidas).toBe(5);
    expect(arq.motor).toBe("notebooklm");
    expect(arq.transacoesExtraidasMetadados).toBe(6);
    expect(arq.linhasIgnoradasSemDoc).toBe(1);
    expect(arq.avisosBalance).toEqual(["Créditos divergentes"]);
    expect(arq.paginas).toHaveLength(1);
    expect(arq.paginas[0]?.pagina).toBe(1);
    expect(arq.paginasVerificar).toBe(0);
  });
});
