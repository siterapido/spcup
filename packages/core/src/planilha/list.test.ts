import { describe, expect, it } from "vitest";
import { buildResumo } from "./status";
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
    expect(linha.origens[0]?.origemExtracao?.arquivoIngestaoId).toBe("a1");
    expect(linha.origens[0]?.indiceLinha).toBe(2);
    expect(linha.origens[1]?.origemExtracao?.arquivoIngestaoId).toBe("a2");
    expect(linha.origens[1]?.indiceLinha).toBe(1);
    expect(linha.eventoStatus).toBe("PENDENTE");
  });

  it("usa arquivoIngestaoId da linha quando origemExtracao ausente", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-arq",
      status: "PENDENTE",
      dataMovimento: "2025-01-01",
      valor: "20.00",
      direcao: "ENTRADA",
      confianca: 0.55,
      justificativa: null,
      pessoa: null,
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "PIX RECEBIDO",
          nomeArquivo: "Extrato Jan PIX (1).pdf",
          arquivoIngestaoId: "arq-pix",
          origemExtracao: null,
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "CRED PIX",
          nomeArquivo: "EXTRATO TOTAL JANEIRO (1) (1).pdf",
          arquivoIngestaoId: "arq-total",
          origemExtracao: null,
        },
      ],
    });
    expect(linha.origens[0]?.arquivoIngestaoId).toBe("arq-pix");
    expect(linha.origens[1]?.arquivoIngestaoId).toBe("arq-total");
  });

  it("usa remetenteDestinatario persistido quando presente", () => {
    const linha = mapMovimentacaoToLinha({
      id: "m-nome",
      dataMovimento: "2025-01-01",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX",
      remetenteDestinatario: "MARIA SILVA",
      confiancaGlobal: 0.85,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    expect(linha.remetenteDestinatario).toBe("MARIA SILVA");
  });

  it("remetenteDestinatario null sem persistencia", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-nome",
      status: "APROVADO",
      dataMovimento: "2025-01-15",
      valor: "50.00",
      direcao: "SAIDA",
      confianca: 0.9,
      justificativa: null,
      pessoa: null,
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "GABRIEL REIS DA SILVA",
          nomeArquivo: "pix.pdf",
          origemExtracao: null,
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
          nomeArquivo: "total.pdf",
          origemExtracao: null,
        },
      ],
    });
    expect(linha.remetenteDestinatario).toBeNull();
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

  it("mescla camposExtracao das origens de PIX e Total", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-campos",
      status: "PENDENTE",
      dataMovimento: "2025-01-15",
      valor: "150.00",
      direcao: "SAIDA",
      confianca: 0.9,
      justificativa: null,
      pessoa: null,
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "PIX ENVIADO JOAO",
          nomeArquivo: "pix.pdf",
          origemExtracao: null,
          camposExtracao: {
            remetente_destinatario: "JOAO SILVA",
            hora: "14:30",
            tipo_pix: "Enviado",
          },
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "JOAO SILVA CPF 123",
          nomeArquivo: "total.pdf",
          origemExtracao: null,
          camposExtracao: {
            documento: "987654",
            historico: "PIX ENVIADO JOAO",
            saldo: "1000.00",
          },
        },
      ],
    });
    expect(linha.camposExtracao).toBeDefined();
    expect(linha.camposExtracao.remetente_destinatario).toBe("JOAO SILVA");
    expect(linha.camposExtracao.hora).toBe("14:30");
    expect(linha.camposExtracao.tipo_pix).toBe("Enviado");
    expect(linha.camposExtracao.documento).toBe("987654");
    expect(linha.camposExtracao.historico).toBe("PIX ENVIADO JOAO");
    expect(linha.camposExtracao.saldo).toBe("1000.00");
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

  it("mapeia camposExtracao da movimentacao flat", () => {
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
      camposExtracao: {
        remetente_destinatario: "MARIA SILVA",
        hora: "12:00",
      },
    });
    expect(linha.camposExtracao).toBeDefined();
    expect(linha.camposExtracao.remetente_destinatario).toBe("MARIA SILVA");
    expect(linha.camposExtracao.hora).toBe("12:00");
    expect(linha.origens[0]?.camposExtracao).toBeDefined();
    expect(linha.origens[0]?.camposExtracao?.remetente_destinatario).toBe("MARIA SILVA");
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

describe("buildResumo semRemetenteDestinatario", () => {
  it("conta linhas sem remetenteDestinatario persistido", () => {
    const comRemetente = mapMovimentacaoToLinha({
      id: "m1",
      dataMovimento: "2025-01-01",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "DEPOSITO MARIA SILVA",
      remetenteDestinatario: "MARIA SILVA",
      confiancaGlobal: 0.85,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    const semRemetente = mapMovimentacaoToLinha({
      id: "m2",
      dataMovimento: "2025-01-02",
      valor: "20.00",
      direcao: "SAIDA",
      descricaoRaw: "CRED PIX",
      confiancaGlobal: 0.8,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    const resumo = buildResumo([comRemetente, semRemetente], false);
    expect(resumo.semRemetenteDestinatario).toBe(1);
  });
});
