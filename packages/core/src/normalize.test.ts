import { describe, expect, it } from "vitest";

import { normalizeCnpj, normalizeCpf, normalizeName } from "./normalize";

describe("normalize", () => {
  it("strips CPF mask", () => {
    expect(normalizeCpf("123.456.789-09")).toBe("12345678909");
  });

  it("accepts alphanumeric CNPJ", () => {
    expect(normalizeCnpj("12.345.678/0001-90")).toHaveLength(14);
  });

  it("normalizes names", () => {
    expect(normalizeName("  João   da  Silva ")).toBe("JOAO DA SILVA");
  });
});
