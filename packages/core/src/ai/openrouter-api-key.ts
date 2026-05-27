/** Normalize and validate OpenRouter API key from env or options. */
export function resolveOpenRouterApiKey(explicit?: string): string {
  const raw = explicit ?? process.env.OPENROUTER_API_KEY;
  if (raw == null) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  const apiKey = raw.trim().replace(/^["']|["']$/g, "");
  if (!apiKey.startsWith("sk-or-v1-")) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return apiKey;
}
