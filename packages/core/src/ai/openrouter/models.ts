import type { ExtractStructuredOptions } from "../openrouter-types";
import {
  DEFAULT_EXTRATO_MODEL,
  DEFAULT_REVIEWER_EXTRATO_MODEL,
  DEFAULT_SECONDARY_EXTRATO_MODEL,
  warnNonGeminiExtratoModel,
} from "../model-profile";

export function resolveExtratoModel(options?: ExtractStructuredOptions): string {
  const fromPrimary = process.env.OPENROUTER_MODEL_PRIMARY?.trim();
  const fromPdf = process.env.OPENROUTER_PDF_MODEL?.trim();
  const model = options?.model ?? fromPrimary ?? fromPdf ?? DEFAULT_EXTRATO_MODEL;
  if (!options?.model) {
    if (fromPdf) {
      warnNonGeminiExtratoModel("OPENROUTER_PDF_MODEL", fromPdf);
    } else if (fromPrimary) {
      warnNonGeminiExtratoModel("OPENROUTER_MODEL_PRIMARY", fromPrimary);
    }
  }
  return model;
}

/** `OPENROUTER_MODEL_SECONDARY=none` disables the second extractor. */
export function resolveSecondaryExtratoModel(): string | null {
  const val = process.env.OPENROUTER_MODEL_SECONDARY?.trim();
  if (val === "none") {
    return null;
  }
  if (val) {
    warnNonGeminiExtratoModel("OPENROUTER_MODEL_SECONDARY", val);
    return val;
  }
  warnNonGeminiExtratoModel(
    "OPENROUTER_MODEL_SECONDARY",
    DEFAULT_SECONDARY_EXTRATO_MODEL,
  );
  return DEFAULT_SECONDARY_EXTRATO_MODEL;
}

export function resolveReviewerExtratoModel(): string {
  const reviewer = process.env.OPENROUTER_MODEL_REVIEWER?.trim();
  if (reviewer && reviewer !== "none") {
    warnNonGeminiExtratoModel("OPENROUTER_MODEL_REVIEWER", reviewer);
    return reviewer;
  }
  const secondary = resolveSecondaryExtratoModel();
  if (secondary) {
    return secondary;
  }
  warnNonGeminiExtratoModel(
    "OPENROUTER_MODEL_REVIEWER",
    DEFAULT_REVIEWER_EXTRATO_MODEL,
  );
  return DEFAULT_REVIEWER_EXTRATO_MODEL;
}
