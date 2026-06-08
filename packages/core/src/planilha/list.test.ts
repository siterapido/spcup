import { describe, expect, it } from "vitest";
import { deriveLinhaStatus } from "./status";
import { mapConsolidacaoEventoToLinha, mapMovimentacaoToLinha } from "./list";

describe("mapConsolidacaoEventoToLinha", () => {
  it("marca merge_pendente com 2 linhas PENDENTE", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-1",
      status: "PENDENTE",
      dataMovimento: "2025-01-15",
      valor: "50.00",
      direcao: "SAIDA",
      confianca: 0.7,
      justificativa: null,
      pessoa: null,
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "PIX JOAO",
          nomeArquivo: "pix.pdf",
          origemExtracao: {
            versao: 1,
            arquivoIngestaoId: "a1",
            nomeArquivo: "pix.pdf",
            pagina: 1,
            indiceLinha: 2,
          },
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "JOAO CPF 123",
          nomeArquivo: "total.pdf",
          origemExtracao: {
            versao: 1,
            arquivoIngestaoId: "a2",
            nomeArquivo: "total.pdf",
            pagina: 2,
            indiceLinha: 1,
          },
        },
      ],
    });
    expect(linha.fonte).toBe("consolidacao");
    expect(linha.status).toBe("merge_pendente");
    expect(linha.origens).toHaveLength(2);
    expect(linha.origens[0]?.arquivoIngestaoId).toBe("a1");
    expect(linha.origens[1]?.arquivoIngestaoId).toBe("a2");
    expect(linha.eventoStatus).toBe("PENDENTE");
  });

  it("deriveLinhaStatus: APROVADO com pessoa vira pronta", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-2",
      status: "APROVADO",
      dataMovimento: "2025-01-15",
      valor: "50.00",
      direcao: "SAIDA",
      confianca: 0.9,
      justificativa: null,
      pessoaFisicaId: "pf1",
      pessoa: { nome: "JOAO", documento: "12345678901", tipo: "PF" },
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "PIX JOAO",
          nomeArquivo: "pix.pdf",
          origemExtracao: null,
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "JOAO",
          nomeArquivo: "total.pdf",
          origemExtracao: null,
        },
      ],
    });
    expect(linha.status).toBe("pronta");
    expect(
      deriveLinhaStatus({
        eventoStatus: "APROVADO",
        origemCount: 2,
        pessoa: linha.pessoa,
        confianca: 0.9,
        extracaoDuvidosa: false,
        extracaoConfirmada: false,
      }),
    ).toBe("pronta");
  });
});

describe("mapMovimentacaoToLinha", () => {
  it("mapeia movimentacao flat", () => {
    const linha = mapMovimentacaoToLinha({
      id: "m1",
      dataMovimento: "2025-01-01",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "DEPOSITO",
      confiancaGlobal: 0.85,
      pessoaFisica: { id: "pf1", nome: "MARIA", cpf: "12345678901" },
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
      statusPaginaVerificar: false,
    });
    expect(linha.fonte).toBe("movimentacao");
    expect(linha.pessoa?.tipo).toBe("PF");
    expect(linha.status).toBe("pronta");
    expect(linha.origens).toHaveLength(1);
    expect(linha.origens[0]?.movimentacaoId).toBe("m1");
  });

  it("sem pessoa fica pendente via deriveLinhaStatus", () => {
    const linha = mapMovimentacaoToLinha({
      id: "m2",
      dataMovimento: "2025-01-02",
      valor: "20.00",
      direcao: "SAIDA",
      descricaoRaw: "PIX TESTE",
      confiancaGlobal: 0.8,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    expect(linha.status).toBe("pendente");
  });
});
