import { describe, expect, it } from "vitest";

import { computeHashMovimento } from "./hash";

const row = {
  dataMovimento: new Date("2025-03-01"),
  valor: "100.00",
  descricaoRaw: "PIX",
  direcao: "ENTRADA" as const,
  nrExtratoBancario: "1",
  credDev: null,
};

describe("computeHashMovimento", () => {
  it("differs when cnpj prestador differs", () => {
    const a = computeHashMovimento("14679407000100", 2025, row);
    const b = computeHashMovimento("12345678000199", 2025, row);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs when discriminador differs", () => {
    const a = computeHashMovimento("14679407000100", 2025, row, "arq-1|0");
    const b = computeHashMovimento("14679407000100", 2025, row, "arq-1|1");
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs when discriminador shares index but different arquivo", () => {
    const a = computeHashMovimento("14679407000100", 2025, row, "arq-1|0");
    const b = computeHashMovimento("14679407000100", 2025, row, "arq-2|0");
    expect(a).not.toBe(b);
  });

  it("keeps backward-compatible hash when discriminador is omitted", () => {
    const without = computeHashMovimento("14679407000100", 2025, row);
    const emptyDisc = computeHashMovimento("14679407000100", 2025, row, "");
    expect(without).toBe(emptyDisc);
  });
});
