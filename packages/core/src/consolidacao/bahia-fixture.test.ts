import { describe, expect, it } from "vitest";

import { buildConsolidacaoCandidates } from "./candidates";
import type { MovimentacaoCandidate } from "./types";

/** Regression shapes from Documentos para teste / (Bahia jan/2025). */
describe("consolidacao bahia fixtures", () => {
  it("scores PIX with remetente + completo with CPF highly when cadastro matches", () => {
    const pix: MovimentacaoCandidate = {
      id: "1",
      arquivoIngestaoId: "a-pix",
      nomeArquivo: "Extrato Jan PIX (1).pdf",
      dataMovimento: "2025-01-15",
      valor: "100.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX",
      remetenteDestinatario: "GABRIEL REIS DA SILVA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
    };
    const total: MovimentacaoCandidate = {
      id: "2",
      arquivoIngestaoId: "a-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO (1) (1).pdf",
      dataMovimento: "2025-01-15",
      valor: "100.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX CPF 12345678901",
      remetenteDestinatario: "GABRIEL REIS DA SILVA",
      cpfExtraido: "12345678901",
      cnpjExtraido: null,
      origemExtracao: null,
    };

    const { drafts } = buildConsolidacaoCandidates([pix, total], {
      pessoaByCpf: new Map([
        ["12345678901", { kind: "PF", id: "pf-gabriel", nome: "GABRIEL REIS DA SILVA" }],
      ]),
      pessoaByCnpj: new Map(),
    }, { arquivoBaseIngestaoId: "a-total" });

    expect(drafts[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(drafts[0]!.linhas).toHaveLength(2);
    expect(drafts[0]!.dataMovimento).toBe("2025-01-15");
  });

  it("pareia PIX com extrato total por documento DDHHMM quando total não traz nome", () => {
    const pix: MovimentacaoCandidate = {
      id: "pix-1",
      arquivoIngestaoId: "a-pix",
      nomeArquivo: "Extrato Jan PIX (1).pdf",
      dataMovimento: "2025-01-10",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "PIX RECEBIDO",
      remetenteDestinatario: "VITOR HUGO MOREAU CUNHA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: null,
      camposExtracao: {
        hora: "07:52:22",
        remetente_destinatario: "VITOR HUGO MOREAU CUNHA",
      },
    };
    const total: MovimentacaoCandidate = {
      id: "total-1",
      arquivoIngestaoId: "a-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO (1) (1).pdf",
      dataMovimento: "2025-01-10",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX",
      remetenteDestinatario: null,
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: null,
      camposExtracao: {
        documento: "100752",
        historico: "CRED PIX",
      },
    };

    const { drafts } = buildConsolidacaoCandidates([pix, total], {
      pessoaByCpf: new Map([
        ["07315922717", { kind: "PF", id: "pf-vitor", nome: "VITOR HUGO M CUNHA" }],
      ]),
      pessoaByCnpj: new Map(),
    }, { arquivoBaseIngestaoId: "a-total" });

    expect(drafts[0]!.linhas).toHaveLength(2);
    expect(drafts[0]!.confianca).toBeGreaterThanOrEqual(0.75);
    expect(drafts[0]!.justificativa).toContain("DDHHMM");
    expect(drafts[0]!.dataMovimento).toBe("2025-01-10");
  });
});
