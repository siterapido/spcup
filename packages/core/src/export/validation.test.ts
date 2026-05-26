import { describe, expect, it } from "vitest";

import {
  requireValidXsd,
  validateSpcaExports,
  XsdValidationError,
} from "./validation";

describe("validateSpcaExports", () => {
  it("returns empty object for empty list", async () => {
    await expect(validateSpcaExports([])).resolves.toEqual({});
  });
});

describe("requireValidXsd", () => {
  it("passes when all error lists are empty", () => {
    expect(() => requireValidXsd({ "origem.xml": [] })).not.toThrow();
  });

  it("raises XsdValidationError when errors exist", () => {
    expect(() => requireValidXsd({ "origem.xml": ["line 1: invalid"] })).toThrow(
      XsdValidationError,
    );
    try {
      requireValidXsd({ "origem.xml": ["line 1: invalid"] });
    } catch (error) {
      expect(error).toBeInstanceOf(XsdValidationError);
      expect((error as XsdValidationError).errorsByFile).toHaveProperty("origem.xml");
    }
  });
});
