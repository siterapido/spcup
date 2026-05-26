import { describe, expect, it } from "vitest";

import { isPlaceholderCnpjPrestador, isValidUf, VALID_UFS } from "./constants";

describe("prestacao/constants", () => {
  it("VALID_UFS has 27 entries", () => {
    expect(VALID_UFS).toHaveLength(27);
  });

  it("isValidUf accepts SP rejects XX", () => {
    expect(isValidUf("SP")).toBe(true);
    expect(isValidUf("XX")).toBe(false);
  });

  it("isPlaceholderCnpjPrestador detects seed prefix", () => {
    expect(isPlaceholderCnpjPrestador("00000000000124")).toBe(true);
    expect(isPlaceholderCnpjPrestador("12345678000190")).toBe(false);
  });
});
