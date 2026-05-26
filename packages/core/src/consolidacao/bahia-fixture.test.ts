import { describe, expect, it } from "vitest";

import { buildConsolidacaoCandidates } from "./candidates";
import type { MovimentacaoCandidate } from "./types";

/** Regression shapes from Documentos para teste / (Bahia jan/2025). */
describe("consolidacao bahia fixtures", () => {
  it("scores PIX nome-only + completo with CPF highly when cadastro matches", () => {
    const pix: MovimentacaoCandidate = {
      id: "1",
      arquivoIngestaoId: "a-pix",
      nomeArquivo: "Extrato Jan PIX (1).pdf",
      dataMovimento: "2025-01-15",
      valor: "100.00",
      direcao: "ENTRADA",
      descricaoRaw: "GABRIEL REIS DA SILVA",
      cpfExtraido: null,
      cnpjExtraido: null,
    };
    const total: MovimentacaoCandidate = {
      id: "2",
      arquivoIngestaoId: "a-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO (1) (1).pdf",
      dataMovimento: "2025-01-15",
      valor: "100.00",
      direcao: "ENTRADA",
      descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
      cpfExtraido: "12345678901",
      cnpjExtraido: null,
    };

    const events = buildConsolidacaoCandidates([pix, total], {
      pessoaByCpf: new Map([
        ["12345678901", { kind: "PF", id: "pf-gabriel", nome: "GABRIEL REIS DA SILVA" }],
      ]),
      pessoaByCnpj: new Map(),
    });

    expect(events[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(events[0]!.linhas).toHaveLength(2);
  });
});
