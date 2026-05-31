/** Extract JSON object/array from model text (fences, prose prefix, bare arrays). */
export function extractJsonFromText(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    text = fenced[1].trim();
  } else {
    const start = text.search(/[\[{]/);
    if (start > 0) {
      text = text.slice(start);
    }
  }
  return JSON.parse(text);
}

export function parseResponseBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new Error("OpenRouter response missing message content");
  }

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("OpenRouter response missing message content");
  }

  const message = (choices[0] as { message?: { content?: unknown } })?.message;
  const content = message?.content;
  if (content == null) {
    throw new Error("OpenRouter response missing message content");
  }

  if (typeof content === "object" && content !== null && !Array.isArray(content)) {
    return content as Record<string, unknown>;
  }

  if (typeof content !== "string") {
    throw new Error("OpenRouter response content is not valid JSON");
  }

  let parsed: unknown;
  try {
    parsed = extractJsonFromText(content);
  } catch {
    throw new Error("OpenRouter response content is not valid JSON");
  }

  if (Array.isArray(parsed)) {
    return { transacoes: parsed };
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("OpenRouter response JSON must be an object");
  }

  return parsed as Record<string, unknown>;
}

/** OCR text from OpenRouter file-parser annotations (mistral-ocr / cloudflare-ai). */
export function extractFileOcrTextFromOpenRouterBody(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }

  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  const message = (choices[0] as { message?: { annotations?: unknown } })?.message;
  const annotations = message?.annotations;
  if (!Array.isArray(annotations)) {
    return "";
  }

  const parts: string[] = [];
  for (const ann of annotations) {
    if (typeof ann !== "object" || ann === null) {
      continue;
    }
    const file = (ann as { type?: string; file?: { content?: unknown } }).file;
    if ((ann as { type?: string }).type !== "file" || !Array.isArray(file?.content)) {
      continue;
    }
    for (const block of file.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: string }).text === "string"
      ) {
        const text = (block as { text: string }).text.trim();
        if (text.length > 0 && !text.startsWith("<file name=")) {
          parts.push(text);
        }
      }
    }
  }

  return parts.join("\n\n");
}
