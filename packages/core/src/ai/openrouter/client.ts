import { resolveOpenRouterApiKey } from "../openrouter-api-key";
import type { ExtractStructuredOptions } from "../openrouter-types";
import { extractFileOcrTextFromOpenRouterBody, parseResponseBody } from "./parse-response";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PDF_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;
const DEFAULT_MAX_TOKENS = 16384;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolvePdfTimeoutMs(): number {
  const raw = process.env.OPENROUTER_PDF_TIMEOUT_MS;
  if (raw != null && raw.trim() !== "") {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_PDF_TIMEOUT_MS;
}

export function resolveMaxTokens(): number {
  const raw = process.env.OPENROUTER_MAX_TOKENS;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MAX_TOKENS;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

export function withMaxTokens(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    temperature: 0.0,
    ...payload,
    max_tokens: resolveMaxTokens(),
  };
}

export interface OpenRouterJsonResult {
  parsed: Record<string, unknown>;
  fileOcrText: string;
}

/** POST chat/completions with retries and optional timeout. */
export async function callOpenRouterJson(
  payload: Record<string, unknown>,
  options?: ExtractStructuredOptions,
): Promise<OpenRouterJsonResult> {
  const apiKey = resolveOpenRouterApiKey(options?.apiKey);
  const fetchFn = options?.fetch ?? fetch;
  const sleepFn = options?.sleep ?? defaultSleep;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchFn(OPENROUTER_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(
            `OpenRouter HTTP ${response.status}: ${errBody.slice(0, 500)}`,
          );
        }

        const body = await response.json();
        return {
          parsed: parseResponseBody(body),
          fileOcrText: extractFileOcrTextFromOpenRouterBody(body),
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) {
        break;
      }
      await sleepFn(RETRY_BACKOFF_MS * attempt);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(String(lastError));
}

/** Shared entry for match/ai and other JSON-schema callers. */
export async function openRouterChatCompletion(
  payload: Record<string, unknown>,
  options?: ExtractStructuredOptions,
): Promise<Record<string, unknown>> {
  const { parsed } = await callOpenRouterJson(payload, options);
  return parsed;
}
