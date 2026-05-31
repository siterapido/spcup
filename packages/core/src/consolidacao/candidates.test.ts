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

  it("pairs PIX with CNPJ in completo same date/value/direction", () => {
    const pixLineCnpj: MovimentacaoCandidate = {
      id: "pix-2",
      arquivoIngestaoId: "arq-pix",
      nomeArquivo: "Extrato Jan PIX.pdf",
      dataMovimento: "2025-01-15",
      valor: "150.00",
      direcao: "ENTRADA",
      descricaoRaw: "AUTO POSTO LTDA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
    };
    const completoLineCnpj: MovimentacaoCandidate = {
      id: "comp-2",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-15",
      valor: "150.00",
      direcao: "ENTRADA",
      descricaoRaw: "AUTO POSTO LTDA CNPJ 12345678000199",
      cpfExtraido: null,
      cnpjExtraido: "12345678000199",
      origemExtracao: null,
    };
    const events = buildConsolidacaoCandidates([pixLineCnpj, completoLineCnpj], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map([
        [
          "12345678000199",
          { kind: "PJ", id: "pj-1", nome: "AUTO POSTO LTDA" },
        ],
      ]),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(events[0]!.pessoaJuridicaId).toBe("pj-1");
  });

  it("handles single-line CNPJ match in cadastro", () => {
    const singleCnpjLine: MovimentacaoCandidate = {
      id: "comp-3",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-15",
      valor: "250.00",
      direcao: "ENTRADA",
      descricaoRaw: "AUTO POSTO LTDA CNPJ 12345678000199",
      cpfExtraido: null,
      cnpjExtraido: "12345678000199",
      origemExtracao: null,
    };
    const events = buildConsolidacaoCandidates([singleCnpjLine], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map([
        [
          "12345678000199",
          { kind: "PJ", id: "pj-1", nome: "AUTO POSTO LTDA" },
        ],
      ]),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.confianca).toBe(0.85);
    expect(events[0]!.pessoaJuridicaId).toBe("pj-1");
  });

  it("pairs PIX and COMPLETO within the 0-to-3 days window", () => {
    const pixSat: MovimentacaoCandidate = {
      id: "pix-sat",
      arquivoIngestaoId: "arq-pix",
      nomeArquivo: "Extrato Jan PIX.pdf",
      dataMovimento: "2025-01-15", // Saturday
      valor: "50.00",
      direcao: "ENTRADA",
      descricaoRaw: "MARIA SILVA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };
    const compMon: MovimentacaoCandidate = {
      id: "comp-mon",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-17", // Monday (2 days later)
      valor: "50.00",
      direcao: "ENTRADA",
      descricaoRaw: "MARIA SILVA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };
    const compTooLate: MovimentacaoCandidate = {
      id: "comp-late",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-20", // 5 days later
      valor: "50.00",
      direcao: "ENTRADA",
      descricaoRaw: "MARIA SILVA",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };

    const eventsGood = buildConsolidacaoCandidates([pixSat, compMon], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });
    expect(eventsGood.filter((e) => e.linhas.length === 2)).toHaveLength(1);

    const eventsBad = buildConsolidacaoCandidates([pixSat, compTooLate], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });
    expect(eventsBad.filter((e) => e.linhas.length === 2)).toHaveLength(0);
  });

  it("handles duplicate amounts chronologically (FIFO)", () => {
    const pix1: MovimentacaoCandidate = {
      id: "pix-1",
      arquivoIngestaoId: "arq-pix",
      nomeArquivo: "Extrato Jan PIX.pdf",
      dataMovimento: "2025-01-15",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "FIRST PIX",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };
    const pix2: MovimentacaoCandidate = {
      id: "pix-2",
      arquivoIngestaoId: "arq-pix",
      nomeArquivo: "Extrato Jan PIX.pdf",
      dataMovimento: "2025-01-16",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "SECOND PIX",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };
    const comp1: MovimentacaoCandidate = {
      id: "comp-1",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-15",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "FIRST COMPLETO",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };
    const comp2: MovimentacaoCandidate = {
      id: "comp-2",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-16",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "SECOND COMPLETO",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "c-1",
    };

    const events = buildConsolidacaoCandidates([pix1, pix2, comp1, comp2], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });

    const pairs = events.filter((e) => e.linhas.length === 2);
    expect(pairs).toHaveLength(2);

    // Verify first pair matches the 15th
    const pair15 = pairs.find((p) => p.dataMovimento === "2025-01-15");
    expect(pair15!.linhas.map((l) => l.movimentacaoId)).toEqual(
      expect.arrayContaining(["pix-1", "comp-1"]),
    );

    // Verify second pair matches the 16th
    const pair16 = pairs.find((p) => p.dataMovimento === "2025-01-16");
    expect(pair16!.linhas.map((l) => l.movimentacaoId)).toEqual(
      expect.arrayContaining(["pix-2", "comp-2"]),
    );
  });

  it("does not pair different bank accounts", () => {
    const pixAcc1: MovimentacaoCandidate = {
      id: "pix-1",
      arquivoIngestaoId: "arq-pix",
      nomeArquivo: "Extrato Jan PIX.pdf",
      dataMovimento: "2025-01-15",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "SOME PIX",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "acc-1",
    };
    const compAcc2: MovimentacaoCandidate = {
      id: "comp-2",
      arquivoIngestaoId: "arq-total",
      nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
      dataMovimento: "2025-01-15",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "SOME COMPLETO",
      cpfExtraido: null,
      cnpjExtraido: null,
      origemExtracao: null,
      contaBancariaId: "acc-2",
    };

    const events = buildConsolidacaoCandidates([pixAcc1, compAcc2], {
      pessoaByCpf: new Map(),
      pessoaByCnpj: new Map(),
    });
    expect(events.filter((e) => e.linhas.length === 2)).toHaveLength(0);
  });
});
