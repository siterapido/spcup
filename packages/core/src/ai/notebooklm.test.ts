import { describe, expect, it } from "vitest";

import { parseNlmCliOutput } from "./notebooklm";

describe("parseNlmCliOutput", () => {
  it("extracts error message from nlm JSON stdout", () => {
    const parsed = parseNlmCliOutput(
      `{
  "status": "error",
  "error": "This notebook has no sources to query. Add a source first."
}`,
    );
    expect(parsed?.status).toBe("error");
    expect(parsed?.error).toContain("no sources");
  });

  it("returns null for non-JSON stdout", () => {
    expect(parseNlmCliOutput("plain text")).toBeNull();
  });
});
