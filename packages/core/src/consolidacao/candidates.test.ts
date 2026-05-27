import { describe, expect, it } from "vitest";

import { buildConsolidacaoCandidates } from "./candidates";
import type { MovimentacaoCandidate } from "./types";

const pixLine: MovimentacaoCandidate = {
  id: "pix-1",
  arquivoIngestaoId: "arq-pix",
  nomeArquivo: "Extrato Jan PIX.pdf",
  dataMovimento: "2025-01-15",
  valor: "100.00",
  direcao: "ENTRADA",
  descricaoRaw: "GABRIEL REIS DA SILVA",
  cpfExtraido: null,
  cnpjExtraido: null,
  origemExtracao: null,
};

const completoLine: MovimentacaoCandidate = {
  id: "comp-1",
  arquivoIngestaoId: "arq-total",
  nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
  dataMovimento: "2025-01-15",
  valor: "100.00",
  direcao: "ENTRADA",
  descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
  cpfExtraido: "12345678901",
  cnpjExtraido: null,
  origemExtracao: null,
};

describe("buildConsolidacaoCandidates", () => {
  it("pairs PIX nome-only with completo same date/value/direction", () => {
    const events = buildConsolidacaoCandidates([pixLine, completoLine], {
      pessoaByCpf: new Map([
        [
          "12345678901",
          { kind: "PF", id: "pf-1", nome: "GABRIEL REIS DA SILVA" },
        ],
      ]),
      pessoaByCnpj: new Map(),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(events[0]!.linhas.map((l) => l.papel)).toEqual(
      expect.arrayContaining(["PIX", "COMPLETO"]),
    );
    expect(events[0]!.pessoaFisicaId).toBe("pf-1");
  });

  it("does not pair different valores", () => {
    const events = buildConsolidacaoCandidates(
      [pixLine, { ...completoLine, valor: "200.00" }],
      { pessoaByCpf: new Map(), pessoaByCnpj: new Map() },
    );
    expect(events.filter((e) => e.linhas.length === 2)).toHaveLength(0);
  });

  it("creates single-line events for unpaired movimentacoes", () => {
    const events = buildConsolidacaoCandidates([pixLine], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.linhas).toHaveLength(1);
  });
});
