import { describe, expect, it } from "vitest";

import { computeHashMovimento } from "./hash";

const row = {
  dataMovimento: new Date("2025-03-01"),
  valor: "100.00",
  descricaoRaw: "PIX",
  direcao: "ENTRADA" as const,
  nrExtratoBancario: "1",
};

describe("computeHashMovimento", () => {
  it("differs when cnpj prestador differs", () => {
    const a = computeHashMovimento("14679407000100", 2025, row);
    const b = computeHashMovimento("12345678000199", 2025, row);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });
});
