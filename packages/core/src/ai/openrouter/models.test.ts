import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_REVIEWER_EXTRATO_MODEL,
  DEFAULT_SECONDARY_EXTRATO_MODEL,
} from "../model-profile";
import {
  resolveExtratoModel,
  resolveReviewerExtratoModel,
  resolveSecondaryExtratoModel,
} from "./models";

describe("resolveSecondaryExtratoModel", () => {
  const prev = process.env.OPENROUTER_MODEL_SECONDARY;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENROUTER_MODEL_SECONDARY;
    } else {
      process.env.OPENROUTER_MODEL_SECONDARY = prev;
    }
  });

  it("defaults to disabled when unset (save tokens; set env to enable dual-extract)", () => {
    delete process.env.OPENROUTER_MODEL_SECONDARY;
    expect(resolveSecondaryExtratoModel()).toBeNull();
    expect(DEFAULT_SECONDARY_EXTRATO_MODEL).toBeNull();
  });

  it("returns null when none", () => {
    process.env.OPENROUTER_MODEL_SECONDARY = "none";
    expect(resolveSecondaryExtratoModel()).toBeNull();
  });
});

describe("resolveReviewerExtratoModel", () => {
  const prevReviewer = process.env.OPENROUTER_MODEL_REVIEWER;
  const prevSecondary = process.env.OPENROUTER_MODEL_SECONDARY;

  afterEach(() => {
    if (prevReviewer === undefined) {
      delete process.env.OPENROUTER_MODEL_REVIEWER;
    } else {
      process.env.OPENROUTER_MODEL_REVIEWER = prevReviewer;
    }
    if (prevSecondary === undefined) {
      delete process.env.OPENROUTER_MODEL_SECONDARY;
    } else {
      process.env.OPENROUTER_MODEL_SECONDARY = prevSecondary;
    }
  });

  it("defaults to Gemini flash when unset", () => {
    delete process.env.OPENROUTER_MODEL_REVIEWER;
    delete process.env.OPENROUTER_MODEL_SECONDARY;
    expect(resolveReviewerExtratoModel()).toBe(DEFAULT_REVIEWER_EXTRATO_MODEL);
    expect(resolveReviewerExtratoModel()).toBe("google/gemini-3.5-flash");
  });

  it("uses OPENROUTER_MODEL_REVIEWER when set", () => {
    process.env.OPENROUTER_MODEL_REVIEWER = "google/gemini-3.5-flash";
    expect(resolveReviewerExtratoModel()).toBe("google/gemini-3.5-flash");
  });
});

describe("resolveExtratoModel env isolation", () => {
  const prevPdf = process.env.OPENROUTER_PDF_MODEL;
  const prevModel = process.env.OPENROUTER_MODEL;

  afterEach(() => {
    if (prevPdf === undefined) {
      delete process.env.OPENROUTER_PDF_MODEL;
    } else {
      process.env.OPENROUTER_PDF_MODEL = prevPdf;
    }
    if (prevModel === undefined) {
      delete process.env.OPENROUTER_MODEL;
    } else {
      process.env.OPENROUTER_MODEL = prevModel;
    }
  });

  it("does not fall back to OPENROUTER_MODEL for extrato", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "openai/gpt-4o-mini";
    expect(resolveExtratoModel()).toBe("google/gemini-3.5-flash");
  });
});
