import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTRATO_MODEL,
  DEFAULT_MATCH_MODEL,
  DEFAULT_REVIEWER_EXTRATO_MODEL,
  DEFAULT_SECONDARY_EXTRATO_MODEL,
  resolveModelProfile,
} from "./model-profile";

describe("resolveModelProfile", () => {
  it("exposes Gemini defaults", () => {
    expect(DEFAULT_EXTRATO_MODEL).toBe("google/gemini-3.5-flash");
    expect(DEFAULT_MATCH_MODEL).toBe("google/gemini-3.5-flash");
    expect(DEFAULT_SECONDARY_EXTRATO_MODEL).toBeNull();
    expect(DEFAULT_REVIEWER_EXTRATO_MODEL).toBe("google/gemini-3.5-flash");
  });

  it("returns kimi profile", () => {
    const p = resolveModelProfile("moonshotai/kimi-k2.6");
    expect(p.responseFormat).toBe("json_object");
    expect(p.pdfBatching).toBe("kimi_conservative");
    expect(p.pdfPlugins).toEqual([
      { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    ]);
    expect(p.ocrTextFallback).toBe(true);
    expect(p.extratoPromptVariant).toBe("kimi");
  });

  it("returns gemini profile", () => {
    const p = resolveModelProfile("google/gemini-3.5-flash");
    expect(p.responseFormat).toBe("json_schema");
    expect(p.pdfBatching).toBe("gemini_native");
    expect(p.pdfPlugins).toBeNull();
    expect(p.ocrTextFallback).toBe(false);
    expect(p.extratoPromptVariant).toBe("gemini");
  });

  it("falls back unknown slugs to gemini_native", () => {
    const p = resolveModelProfile("anthropic/claude-sonnet-4");
    expect(p.pdfBatching).toBe("gemini_native");
    expect(p.responseFormat).toBe("json_schema");
  });
});
