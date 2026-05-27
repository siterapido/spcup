export const DEFAULT_EXTRATO_MODEL = "google/gemini-3.5-flash";
export const DEFAULT_MATCH_MODEL = "google/gemini-3.5-flash";

export type ResponseFormatKind = "json_schema" | "json_object";
export type PdfBatchingStrategy = "gemini_native" | "kimi_conservative";
export type ExtratoPromptVariant = "gemini" | "kimi";

export interface ModelProfile {
  slug: string;
  responseFormat: ResponseFormatKind;
  pdfBatching: PdfBatchingStrategy;
  pdfPlugins: Array<{ id: string; pdf?: { engine: string } }> | null;
  ocrTextFallback: boolean;
  extratoPromptVariant: ExtratoPromptVariant;
}

const MISTRAL_OCR_PLUGINS: ModelProfile["pdfPlugins"] = [
  { id: "file-parser", pdf: { engine: "mistral-ocr" } },
];

const GEMINI_PROFILE: Omit<ModelProfile, "slug"> = {
  responseFormat: "json_schema",
  pdfBatching: "gemini_native",
  pdfPlugins: null,
  ocrTextFallback: false,
  extratoPromptVariant: "gemini",
};

const KIMI_PROFILE: Omit<ModelProfile, "slug"> = {
  responseFormat: "json_object",
  pdfBatching: "kimi_conservative",
  pdfPlugins: MISTRAL_OCR_PLUGINS,
  ocrTextFallback: true,
  extratoPromptVariant: "kimi",
};

export function resolveModelProfile(model: string): ModelProfile {
  const slug = model.trim();
  if (/kimi/i.test(slug)) {
    return { slug, ...KIMI_PROFILE };
  }
  return { slug, ...GEMINI_PROFILE };
}

/** @deprecated Use resolveModelProfile(model).pdfBatching === "kimi_conservative" */
export function isKimiModel(model: string): boolean {
  return resolveModelProfile(model).pdfBatching === "kimi_conservative";
}
