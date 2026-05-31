import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../ai/openrouter");

import {
  INGESTAO_PAGINA_STATUS,
  isNonTransactionalPage,
  partitionDualTransactions,
  transactionConsensusKey,
} from "./dual-extract";

beforeEach(() => {
  delete process.env.INGEST_NON_TRANSACTIONAL_MIN_CHARS;
  delete process.env.INGEST_SCORE_THRESHOLD;
});

describe("transactionConsensusKey", () => {
  it("builds key from date, cents and direction", () => {
    expect(
      transactionConsensusKey({
        data: "2025-01-15",
        valor: "123,45",
        direcao: "ENTRADA",
      }),
    ).toBe("2025-01-15|12345|ENTRADA");
  });

  it("returns null for invalid rows", () => {
    expect(transactionConsensusKey({ data: "15/01/2025", valor: 10, direcao: "ENTRADA" })).toBeNull();
    expect(transactionConsensusKey({ data: "2025-01-15", valor: "x", direcao: "ENTRADA" })).toBeNull();
    expect(transactionConsensusKey({ data: "2025-01-15", valor: 10, direcao: "INVALID" })).toBeNull();
  });
});

describe("isNonTransactionalPage", () => {
  it("returns false when either model found transactions", () => {
    expect(isNonTransactionalPage("saldo final", 1, 0)).toBe(false);
    expect(isNonTransactionalPage("saldo final", 0, 2)).toBe(false);
  });

  it("returns true for short text without transactions", () => {
    expect(isNonTransactionalPage("ok", 0, 0)).toBe(true);
  });

  it("returns true for footer keywords without transactions", () => {
    expect(isNonTransactionalPage("Saldo em conta corrente: R$ 0,00", 0, 0)).toBe(true);
  });

  it("returns false for long transactional-looking text without transactions", () => {
    const text =
      "Movimentação bancária detalhada com várias colunas de lançamentos sem linhas reconhecidas nesta página do extrato para revisão manual pelo operador.";
    expect(isNonTransactionalPage(text, 0, 0)).toBe(false);
  });
});

describe("partitionDualTransactions", () => {
  const base = { data: "2025-03-01", valor: "100.00", direcao: "SAIDA" };

  it("places matching keys in consenso", () => {
    const primary = [{ ...base, nome: "A" }];
    const secondary = [{ ...base, nome: "Alice Longer Name" }];
    const { consenso, divergentes } = partitionDualTransactions(primary, secondary);
    expect(consenso).toHaveLength(1);
    expect(consenso[0]?.consenso).toBe(true);
    expect(consenso[0]?.score).toBe(100);
    expect(consenso[0]?.modeloOrigem).toBe("consenso");
    expect(String(consenso[0]?.item.nome)).toBe("Alice Longer Name");
    expect(divergentes).toHaveLength(0);
  });

  it("splits unique primary and secondary lines into divergentes", () => {
    const primary = [
      { ...base, nome: "Only A" },
      { data: "2025-03-02", valor: "50.00", direcao: "ENTRADA", nome: "Shared" },
    ];
    const secondary = [
      { data: "2025-03-02", valor: "50.00", direcao: "ENTRADA", nome: "Shared" },
      { data: "2025-03-03", valor: "10.00", direcao: "SAIDA", nome: "Only B" },
    ];
    const { consenso, divergentes } = partitionDualTransactions(primary, secondary);
    expect(consenso).toHaveLength(1);
    expect(divergentes).toHaveLength(2);
    expect(divergentes.some((d) => d.origem === "primario")).toBe(true);
    expect(divergentes.some((d) => d.origem === "secundario")).toBe(true);
  });

  it("pairs multiple identical keys and marks excess as divergent", () => {
    const dup = { ...base, nome: "Dup" };
    const { consenso, divergentes } = partitionDualTransactions([dup, dup], [dup]);
    expect(consenso).toHaveLength(1);
    expect(divergentes).toHaveLength(1);
    expect(divergentes[0]!.origem).toBe("primario");
  });
});

describe("INGESTAO_PAGINA_STATUS", () => {
  it("exposes expected page statuses", () => {
    expect(INGESTAO_PAGINA_STATUS.OK).toBe("OK");
    expect(INGESTAO_PAGINA_STATUS.NAO_TRANSACIONAL).toBe("NAO_TRANSACIONAL");
    expect(INGESTAO_PAGINA_STATUS.VERIFICAR).toBe("VERIFICAR");
    expect(INGESTAO_PAGINA_STATUS.ERRO).toBe("ERRO");
  });
});
