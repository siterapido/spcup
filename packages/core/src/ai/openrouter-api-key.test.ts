import { afterEach, describe, expect, it } from "vitest";

import { resolveOpenRouterApiKey } from "./openrouter-api-key";

describe("resolveOpenRouterApiKey", () => {
  const prev = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = prev;
    }
  });

  it("rejects empty and quoted placeholders", () => {
    process.env.OPENROUTER_API_KEY = '""';
    expect(() => resolveOpenRouterApiKey()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("accepts sk-or-v1 keys with surrounding whitespace", () => {
    process.env.OPENROUTER_API_KEY = "  sk-or-v1-test-key  ";
    expect(resolveOpenRouterApiKey()).toBe("sk-or-v1-test-key");
  });
});
