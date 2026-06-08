import { describe, expect, it } from "vitest";

import {
  normalizeCnpj,
  normalizeCpf,
  normalizeCpfDigitsOnly,
  normalizeName,
} from "./normalize";

describe("normalize", () => {
  it("strips CPF mask", () => {
    expect(normalizeCpf("123.456.789-09")).toBe("12345678909");
  });

  it("accepts CPF digits without check-digit validation", () => {
    expect(normalizeCpfDigitsOnly("046.658.238-28")).toBe("04665823828");
    expect(normalizeCpfDigitsOnly("04665823828")).toBe("04665823828");
  });

  it("rejects repeated-digit CPF on import path", () => {
    expect(() => normalizeCpfDigitsOnly("111.111.111-11")).toThrow(/repetida/i);
  });

  it("accepts alphanumeric CNPJ", () => {
    expect(normalizeCnpj("12.345.678/0001-90")).toHaveLength(14);
  });

  it("normalizes names", () => {
    expect(normalizeName("  João   da  Silva ")).toBe("JOAO DA SILVA");
  });
});
