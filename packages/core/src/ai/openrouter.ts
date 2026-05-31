import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { MIN_TEXT_CHARS } from "../ingest/pdf-text";
import {
  dedupeExtratoTransactions,
  getPdfPageCount,
  shouldBatchPdfVision,
  splitPdfIntoBatches,
} from "../ingest/pdf-split";
import {
  DEFAULT_EXTRATO_MODEL,
  resolveModelProfile,
} from "./model-profile";
import {
  readExtratoPdfCache,
  readExtratoTextCache,
  writeExtratoPdfCache,
  writeExtratoTextCache,
} from "./openrouter-cache";
import { resolveOpenRouterApiKey } from "./openrouter-api-key";

export { isKimiModel } from "./model-profile";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PDF_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;
/** Cap model output size (extrato lists are bounded; saves cost on runaway completions). */
const DEFAULT_MAX_TOKENS = 16384;
/** Text-path statements above this are truncated before the API call. */
export const MAX_EXTRATO_TEXT_CHARS = 24_000;
const DEFAULT_PDF_MODEL = DEFAULT_EXTRATO_MODEL;

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    cpf: { type: "string", description: "CPF digits only, 11 characters" },
    nome: { type: "string", description: "Counterparty name from the document" },
    valor: { type: "number", description: "Transaction amount in BRL" },
    data: { type: "string", description: "Transaction date in YYYY-MM-DD format" },
    direcao: {
      type: "string",
      enum: ["ENTRADA", "SAIDA"],
      description: "ENTRADA for credits, SAIDA for debits",
    },
  },
  required: ["cpf", "nome", "valor", "data", "direcao"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT =
  "You extract structured bank transaction data from Brazilian financial PDF documents. " +
  "Return only the requested JSON fields. Use ENTRADA for credits and SAIDA for debits. " +
  "Normalize CPF to digits only.";

/** Azure/OpenRouter strict json_schema: every property key must appear in `required`. */
const EXTRATO_TRANSACTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    data: { type: "string", description: "Transaction date in YYYY-MM-DD format" },
    valor: { type: "number", description: "Amount in BRL" },
    direcao: {
      type: "string",
      enum: ["ENTRADA", "SAIDA"],
      description: "ENTRADA for credits, SAIDA for debits",
    },
    descricao: { type: "string", description: "Transaction description / memo" },
    cred_dev: {
      type: ["string", "null"],
      description: "Cred/Dev column code from the statement (e.g. CRED TEV, PIX); null if absent",
    },
    cpf: { type: ["string", "null"], description: "CPF digits only when present; otherwise null" },
    cnpj: { type: ["string", "null"], description: "CNPJ digits only when present; otherwise null" },
    nome: { type: ["string", "null"], description: "Counterparty name when present; otherwise null" },
    pagina: {
      type: ["integer", "null"],
      description: "1-based page number in the PDF; null if unknown",
    },
    indice_linha: {
      type: ["integer", "null"],
      description: "1-based row index on that page in visual order; null if unknown",
    },
    bbox: {
      type: ["object", "null"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
      },
      required: ["x", "y", "w", "h"],
      additionalProperties: false,
      description: "Normalized 0-1 box around the transaction row; null if unknown",
    },
  },
  required: [
    "data",
    "valor",
    "direcao",
    "descricao",
    "cred_dev",
    "cpf",
    "cnpj",
    "nome",
    "pagina",
    "indice_linha",
    "bbox",
  ],
  additionalProperties: false,
} as const;

const EXTRATO_ARRAY_SCHEMA = {
  type: "object",
  properties: {
    transacoes: {
      type: "array",
      items: EXTRATO_TRANSACTION_ITEM_SCHEMA,
      description: "All transactions found in the statement",
    },
  },
  required: ["transacoes"],
  additionalProperties: false,
} as const;

const KIMI_EXTRATO_SYSTEM_PROMPT =
  "Você extrai transações de extrato bancário brasileiro (PDF ou texto). " +
  'Responda APENAS JSON: {"transacoes":[{"data":"YYYY-MM-DD","valor":0,"direcao":"ENTRADA|SAIDA",' +
  '"descricao":"...","cred_dev":"...","nome":"...","cpf":"11digitos","cnpj":"14digitos",' +
  '"pagina":1,"indice_linha":1,"bbox":{"x":0,"y":0,"w":1,"h":0.05}}]}. ' +
  "Analise detalhadamente cada linha e coluna. O texto extraído de tabelas pode estar fora de ordem visual: identifique e associe corretamente a data, valor e descrição de cada movimentação. " +
  "Não pule NENHUMA transação de entrada/crédito ou saída/débito visível. " +
  "cred_dev = código da coluna Cred/Dev quando existir. Use ENTRADA para crédito e SAIDA para débito. " +
  "cpf/cnpj só dígitos se visíveis; senão preencha nome. " +
  "pagina e indice_linha por transação; bbox normalizado 0-1 na página. " +
  "Não invente linhas.";

const KIMI_EXTRATO_USER_PDF =
  "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.";

const GEMINI_EXTRATO_SYSTEM_PROMPT =
  "Você extrai transações de extrato bancário brasileiro (PDF ou texto). " +
  'Responda APENAS JSON válido no schema: {"transacoes":[{"data":"YYYY-MM-DD","valor":0,"direcao":"ENTRADA|SAIDA",' +
  '"descricao":"...","cred_dev":"...","nome":"...","cpf":"11digitos","cnpj":"14digitos",' +
  '"pagina":1,"indice_linha":1,"bbox":{"x":0,"y":0,"w":1,"h":0.05}}]}. ' +
  "Analise detalhadamente cada linha e coluna. O texto extraído de tabelas pode estar fora de ordem visual: identifique e associe corretamente a data, valor e descrição de cada movimentação. " +
  "Não pule NENHUMA transação de entrada/crédito ou saída/débito visível. " +
  "cred_dev = código da coluna Cred/Dev do extrato. Use ENTRADA para crédito e SAIDA para débito. " +
  "Preencha nome com o contraparte quando visível; cpf/cnpj só dígitos. " +
  "pagina e indice_linha por transação; bbox normalizado 0-1 na página. " +
  "Não invente linhas.";

export interface ExtractStructuredOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
  filename?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** When true, bypass OpenRouter disk cache (retry / force reprocess). */
  skipCache?: boolean;
}

function extratoSystemPrompt(model: string): string {
  const variant = resolveModelProfile(model).extratoPromptVariant;
  return variant === "kimi" ? KIMI_EXTRATO_SYSTEM_PROMPT : GEMINI_EXTRATO_SYSTEM_PROMPT;
}

function buildStructuredResponseFormat(
  model: string,
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (resolveModelProfile(model).responseFormat === "json_object") {
    return { type: "json_object" };
  }
  return {
    type: "json_schema",
    json_schema: {
      name,
      strict: true,
      schema,
    },
  };
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

export interface ExtratoExtraction {
  transacoes: Array<Record<string, unknown>>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodePdf(buffer: Buffer): string {
  return `data:application/pdf;base64,${buffer.toString("base64")}`;
}

function resolveMaxTokens(): number {
  const raw = process.env.OPENROUTER_MAX_TOKENS;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_MAX_TOKENS;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_TOKENS;
}

function withMaxTokens(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    temperature: 0.0,
    ...payload,
    max_tokens: resolveMaxTokens(),
  };
}

/** Kimi on OpenRouter often misses native PDF; force OCR parsing for file inputs. */
function withPdfParserPlugins(
  payload: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const plugins = resolveModelProfile(model).pdfPlugins;
  if (!plugins) {
    return payload;
  }
  return { ...payload, plugins };
}

function buildPayload(buffer: Buffer, filename: string, model: string): Record<string, unknown> {
  return withMaxTokens({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extract the main transaction from this PDF: cpf, nome, valor, " +
              "data (YYYY-MM-DD), and direcao (ENTRADA or SAIDA).",
          },
          {
            type: "file",
            file: {
              filename,
              file_data: encodePdf(buffer),
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "pdf_transaction",
        strict: true,
        schema: EXTRACTION_SCHEMA,
      },
    },
  });
}

function buildExtratoTextPayload(statementText: string, model: string): Record<string, unknown> {
  return withMaxTokens({
    model,
    messages: [
      { role: "system", content: extratoSystemPrompt(model) },
      {
        role: "user",
        content:
          "Extraia todas as transações do texto abaixo.\n\n" +
          "---\n" +
          statementText +
          "\n---",
      },
    ],
    response_format: buildStructuredResponseFormat(
      model,
      "extrato_transacoes",
      EXTRATO_ARRAY_SCHEMA as unknown as Record<string, unknown>,
    ),
  });
}

function encodePng(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function buildExtratoImagePayload(
  pngBuffer: Buffer,
  filename: string,
  model: string,
): Record<string, unknown> {
  return withMaxTokens({
    model,
    messages: [
      { role: "system", content: extratoSystemPrompt(model) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Extraia todas as transações visíveis nesta imagem de extrato bancário. " +
              "Retorne somente o JSON.",
          },
          {
            type: "image_url",
            image_url: { url: encodePng(pngBuffer) },
          },
        ],
      },
    ],
    response_format: buildStructuredResponseFormat(
      model,
      "extrato_transacoes",
      EXTRATO_ARRAY_SCHEMA as unknown as Record<string, unknown>,
    ),
  });
}

const LINHA_SCORE_SCHEMA = {
  type: "object",
  properties: {
    linhas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          indice: { type: "integer" },
          score: { type: "integer", description: "0-100 confidence" },
          motivo: {
            type: ["string", "null"],
            description: "Short reason for the score; null if not provided",
          },
        },
        required: ["indice", "score", "motivo"],
        additionalProperties: false,
      },
    },
  },
  required: ["linhas"],
  additionalProperties: false,
} as const;

function buildExtratoFilePayload(
  buffer: Buffer,
  filename: string,
  model: string,
): Record<string, unknown> {
  return withPdfParserPlugins(
    withMaxTokens({
      model,
      messages: [
        { role: "system", content: extratoSystemPrompt(model) },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                resolveModelProfile(model).extratoPromptVariant === "kimi"
                  ? KIMI_EXTRATO_USER_PDF
                  : "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.",
            },
            {
              type: "file",
              file: {
                filename,
                file_data: encodePdf(buffer),
              },
            },
          ],
        },
      ],
      response_format: buildStructuredResponseFormat(
        model,
        "extrato_transacoes",
        EXTRATO_ARRAY_SCHEMA as unknown as Record<string, unknown>,
      ),
    }),
    model,
  );
}

function trimExtratoText(statementText: string): string {
  const trimmed = statementText.trim();
  if (trimmed.length <= MAX_EXTRATO_TEXT_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_EXTRATO_TEXT_CHARS);
}

/** Extract JSON object/array from model text (fences, prose prefix, bare arrays). */
function extractJsonFromText(raw: string): unknown {
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

function parseResponseBody(body: unknown): Record<string, unknown> {
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

interface OpenRouterJsonResult {
  parsed: Record<string, unknown>;
  fileOcrText: string;
}

async function resolvePdfInput(
  pathOrBuffer: string | Buffer,
  filename?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  if (Buffer.isBuffer(pathOrBuffer)) {
    return {
      buffer: pathOrBuffer,
      filename: filename ?? "document.pdf",
    };
  }

  const resolved = path.resolve(pathOrBuffer);
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`PDF not found: ${resolved}`);
  }

  return {
    buffer: await readFile(resolved),
    filename: filename ?? path.basename(resolved),
  };
}

export function resolveExtratoModel(options?: ExtractStructuredOptions): string {
  return (
    options?.model ??
    process.env.OPENROUTER_MODEL_PRIMARY ??
    process.env.OPENROUTER_PDF_MODEL ??
    DEFAULT_PDF_MODEL
  );
}

export function resolveSecondaryExtratoModel(): string | null {
  const val = process.env.OPENROUTER_MODEL_SECONDARY?.trim();
  if (val === "none" || !val) {
    return null;
  }
  return val;
}

export function resolveReviewerExtratoModel(): string {
  const reviewer = process.env.OPENROUTER_MODEL_REVIEWER?.trim();
  if (reviewer) {
    return reviewer;
  }
  return resolveSecondaryExtratoModel() || "openai/gpt-4o-mini";
}

export function parseExtratoValor(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return Number.NaN;
  }
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized);
}

const SHORT_BANK_CODE = /^[A-Z0-9][A-Z0-9\s.\-/]{2,14}$/;

function inferNomeFromDescricao(descricao: string): string | undefined {
  const text = descricao.trim();
  if (text.length < 8) {
    return undefined;
  }
  if (SHORT_BANK_CODE.test(text)) {
    return undefined;
  }
  return text;
}

function normalizeExtratoItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item };
  const contraparte = String(out.contraparte ?? "").trim();
  const nome = String(out.nome ?? "").trim();
  if (!nome && contraparte) {
    out.nome = contraparte;
  }

  const nomeStr = String(out.nome ?? "").trim();
  const descricaoStr = String(out.descricao ?? "").trim();
  if (!nomeStr && descricaoStr) {
    const inferred = inferNomeFromDescricao(descricaoStr);
    if (inferred) {
      out.nome = inferred;
    }
  }

  let credDev = String(out.cred_dev ?? out.credDev ?? "")
    .trim()
    .replace(/^null$/i, "");
  if (!credDev && descricaoStr && SHORT_BANK_CODE.test(descricaoStr)) {
    credDev = descricaoStr;
  }
  if (credDev) {
    out.cred_dev = credDev;
  }

  const docRaw = String(out.cpf_cnpj ?? out.documento ?? "").replace(/\D/g, "");
  if (!out.cpf && docRaw.length === 11) {
    out.cpf = docRaw;
  } else if (!out.cnpj && docRaw.length === 14) {
    out.cnpj = docRaw;
  }

  const valor = parseExtratoValor(out.valor);
  if (Number.isFinite(valor)) {
    out.valor = valor;
  }

  return out;
}

function normalizeExtratoResponse(parsed: Record<string, unknown>): ExtratoExtraction {
  const raw = parsed.transacoes;
  if (!Array.isArray(raw)) {
    return { transacoes: [] };
  }

  return {
    transacoes: raw.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? normalizeExtratoItem(item as Record<string, unknown>)
        : {},
    ),
  };
}

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

/** Extract structured transaction fields from a PDF via OpenRouter. */
export async function extractStructuredFromPdf(
  pathOrBuffer: string | Buffer,
  options?: ExtractStructuredOptions,
): Promise<Record<string, unknown>> {
  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? "google/gemini-3.5-flash";
  const { buffer, filename } = await resolvePdfInput(pathOrBuffer, options?.filename);
  const payload = buildPayload(buffer, filename, model);
  const { parsed } = await callOpenRouterJson(payload, options);
  return parsed;
}

export async function extractTransactionsFromPdfText(
  statementText: string,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  const normalized = trimExtratoText(statementText);
  if (!options?.skipCache) {
    const cached = await readExtratoTextCache(normalized, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoTextPayload(normalized, model);
  const { parsed } = await callOpenRouterJson(payload, options);
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoTextCache(normalized, model, extraction);
  return extraction;
}

/** Extract extrato transactions from a PNG page image (scan path). */
export async function extractTransactionsFromImagePng(
  pngBuffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  if (!options?.skipCache) {
    const cached = await readExtratoPdfCache(pngBuffer, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoImagePayload(
    pngBuffer,
    options?.filename ?? "page.png",
    model,
  );
  const { parsed } = await callOpenRouterJson(payload, {
    ...options,
    timeoutMs: options?.timeoutMs ?? resolvePdfTimeoutMs(),
  });
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoPdfCache(pngBuffer, model, extraction);
  return extraction;
}

export type LinhaScoreResult = { score: number; motivo: string };

/** Reviewer scores divergent lines (0–100) in one batch call. */
export async function scoreExtratoLinhas(
  pageText: string,
  items: Array<Record<string, unknown>>,
  options?: ExtractStructuredOptions,
): Promise<LinhaScoreResult[]> {
  if (items.length === 0) {
    return [];
  }

  const model = options?.model ?? resolveReviewerExtratoModel();
  const linesJson = JSON.stringify(
    items.map((item, indice) => ({ indice, ...item })),
    null,
    0,
  );

  const payload = withMaxTokens({
    model,
    messages: [
      {
        role: "system",
        content:
          "You validate bank statement transaction rows extracted from OCR. " +
          "Return a score 0-100 per line: how likely the row is a real transaction " +
          "with correct date, amount, and direction given the page text.",
      },
      {
        role: "user",
        content:
          "Page text sample:\n---\n" +
          pageText.slice(0, 8000) +
          "\n---\n\nCandidate rows:\n" +
          linesJson,
      },
    ],
    response_format: buildStructuredResponseFormat(
      model,
      "linha_scores",
      LINHA_SCORE_SCHEMA as unknown as Record<string, unknown>,
    ),
  });

  const { parsed } = await callOpenRouterJson(payload, options);
  const rawLinhas = parsed.linhas;
  const byIndex = new Map<number, LinhaScoreResult>();

  if (Array.isArray(rawLinhas)) {
    for (const entry of rawLinhas) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const indice = Number(row.indice);
      const score = Number(row.score);
      if (!Number.isInteger(indice) || indice < 0 || indice >= items.length) {
        continue;
      }
      const clamped = Number.isFinite(score)
        ? Math.min(100, Math.max(0, Math.round(score)))
        : 0;
      byIndex.set(indice, {
        score: clamped,
        motivo: String(row.motivo ?? "").trim() || "Revisor",
      });
    }
  }

  return items.map((_, indice) =>
    byIndex.get(indice) ?? { score: 0, motivo: "Sem score do revisor" },
  );
}

async function extractTransactionsFromSinglePdfBuffer(
  buffer: Buffer,
  options: ExtractStructuredOptions | undefined,
  model: string,
  filename: string,
): Promise<ExtratoExtraction> {
  if (!options?.skipCache) {
    const cached = await readExtratoPdfCache(buffer, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoFilePayload(buffer, filename, model);
  const { parsed, fileOcrText } = await callOpenRouterJson(payload, {
    ...options,
    timeoutMs: options?.timeoutMs ?? resolvePdfTimeoutMs(),
  });
  let extraction = normalizeExtratoResponse(parsed);

  const profile = resolveModelProfile(model);
  const ocrText = fileOcrText.trim();
  if (
    profile.ocrTextFallback &&
    extraction.transacoes.length === 0 &&
    ocrText.length >= MIN_TEXT_CHARS
  ) {
    extraction = await extractTransactionsFromPdfText(ocrText, {
      ...options,
      model,
      filename,
    });
  }

  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}

export async function extractTransactionsFromPdfFile(
  buffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  if (!options?.skipCache) {
    const fullCached = await readExtratoPdfCache(buffer, model);
    if (fullCached) {
      return fullCached;
    }
  }

  const baseName = options?.filename ?? "document.pdf";
  const pageCount = await getPdfPageCount(buffer);
  const useBatches = shouldBatchPdfVision(buffer, pageCount, model);

  if (!useBatches) {
    return extractTransactionsFromSinglePdfBuffer(buffer, options, model, baseName);
  }

  const batches = await splitPdfIntoBatches(buffer);
  const merged: Array<Record<string, unknown>> = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batchBuffer = batches[index]!;
    const batchName =
      batches.length === 1
        ? baseName
        : `${baseName.replace(/\.pdf$/i, "")}_p${index + 1}.pdf`;

    const part = await extractTransactionsFromSinglePdfBuffer(
      batchBuffer,
      options,
      model,
      batchName,
    );
    const batchPagina = index + 1;
    for (const tx of part.transacoes) {
      tx.__batch_pagina = batchPagina;
    }
    merged.push(...part.transacoes);
  }

  const extraction: ExtratoExtraction = {
    transacoes: dedupeExtratoTransactions(merged),
  };
  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}

export async function runConsolidacaoCritique(
  drafts: any[],
  cadastros: { pfs: any[]; pjs: any[] },
  sessaoCtx: { uf: string; exercicio: number },
  options?: ExtractStructuredOptions,
): Promise<any[]> {
  if (drafts.length === 0) {
    return drafts;
  }

  // 1. Call primary model (Gemini 3.5 Flash) to generate proposals
  const primaryModel = options?.model ?? resolveExtratoModel(options);
  const promptPrimary = `
Você é o modelo de IA primário responsável por analisar lançamentos de extratos bancários de uma prestação de contas eleitoral (${sessaoCtx.uf} / ${sessaoCtx.exercicio}) e encontrar possíveis vínculos com as pessoas físicas (PF) ou jurídicas (PJ) cadastradas no sistema.

Cadastros de Pessoas:
PFs: ${JSON.stringify(cadastros.pfs.map(p => ({ id: p.id, nome: p.nome, cpf: p.cpf })))}
PJs: ${JSON.stringify(cadastros.pjs.map(p => ({ id: p.id, nome: p.nome, cnpj: p.cnpj })))}

Eventos Candidatos a Consolidação:
${JSON.stringify(drafts.map((d, index) => ({
  index,
  dataMovimento: d.dataMovimento,
  valor: d.valor,
  direcao: d.direcao,
  linhas: d.linhas.map((l: any) => ({ papel: l.papel, descricaoRaw: l.descricaoRaw }))
})))}

Instruções:
1. Examine as descrições brutas (descricaoRaw) de cada candidato.
2. Identifique se a pessoa mencionada na transação corresponde a algum cadastro (PF ou PJ). Use lógica de similaridade de nome: ignore diferenças de caixa (Caps Lock), acentuação, preposições ("de", "da", "dos", etc.) e abreviações de nomes do meio (focando no primeiro nome e no último sobrenome).
3. Se houver homônimos (nomes iguais ou muito similares) com o mesmo valor, ou qualquer ambiguidade, não faça o vínculo automaticamente; marque para avaliação do revisor.
4. Para cada candidato, proponha o melhor match, se houver.
5. Sua resposta DEVE ser um objeto JSON no seguinte formato:
{
  "propostas": [
    {
      "index": 0,
      "pessoaFisicaId": "id-do-cadastro-ou-null-ou-vazio",
      "pessoaJuridicaId": "id-do-cadastro-ou-null-ou-vazio",
      "justificativa": "Sua explicação detalhada do match"
    }
  ]
}
`;

  const primaryPayload = withMaxTokens({
    model: primaryModel,
    messages: [
      {
        role: "system",
        content: "Você é um assistente especialista em conciliação contábil que extrai e sugere correspondências em formato JSON estruturado.",
      },
      {
        role: "user",
        content: promptPrimary,
      },
    ],
    response_format: { type: "json_object" }
  });

  let sugestoesPrimarias: any = { propostas: [] };
  try {
    const { parsed } = await callOpenRouterJson(primaryPayload, options);
    sugestoesPrimarias = parsed;
  } catch (err) {
    console.error("Erro no modelo primário durante a consolidação AI:", err);
  }

  // 2. Call reviewer model (GPT-4o-mini) to critique the proposals
  const reviewerModel = resolveReviewerExtratoModel();
  const promptReviewer = `
Você é o modelo revisor/avaliador crítico de contabilidade eleitoral.
Sua missão é avaliar rigorosamente as propostas de match entre lançamentos bancários e pessoas cadastradas (PF/PJ) geradas pelo modelo primário.
Evite a todo custo matches incorretos (falsos positivos) que possam invalidar a prestação de contas oficial.

Cadastros de Pessoas:
PFs: ${JSON.stringify(cadastros.pfs.map(p => ({ id: p.id, nome: p.nome, cpf: p.cpf })))}
PJs: ${JSON.stringify(cadastros.pjs.map(p => ({ id: p.id, nome: p.nome, cnpj: p.cnpj })))}

Eventos Candidatos a Consolidação:
${JSON.stringify(drafts.map((d, index) => ({
  index,
  dataMovimento: d.dataMovimento,
  valor: d.valor,
  direcao: d.direcao,
  linhas: d.linhas.map((l: any) => ({ papel: l.papel, descricaoRaw: l.descricaoRaw }))
})))}

Sugestões do Modelo Primário:
${JSON.stringify(sugestoesPrimarias, null, 2)}

Instruções para a Crítica:
1. Para cada evento, analise as sugestões do modelo primário. Se o match for forçado ou incorreto, você DEVE rejeitá-lo (retornando vazio ou null para os IDs).
2. Use similaridade de nome rigorosa (ignore acentos, caixa, preposições e abreviações).
3. Se houver homônimos (nomes parecidos) com o mesmo valor, ou se a semelhança for fraca/duvidosa, atribua uma nota de confiança baixa (abaixo de 0.65) e explique o motivo na justificativa. Isso colocará o item em análise manual pelo operador.
4. Defina uma nota final de confiança (de 0.00 a 1.00) com base na solidez do match:
   - 0.90 a 0.95: CPF/CNPJ ou nome idêntico e único.
   - 0.70 a 0.85: Nome com abreviações óbvias, e valor correspondente.
   - 0.40 a 0.65: Indícios mas sem certeza absoluta (match duvidoso/homônimo).
   - Abaixo de 0.40: Sem vínculo seguro.
5. Escreva uma justificativa final clara e direta baseada na sua crítica (ex: "Match aprovado pelo revisor: GABRIEL R SILVA coincide com GABRIEL REIS DA SILVA", ou "Divergência/homônimo: match marcado como duvidoso para verificação humana").
6. Sua resposta DEVE ser um objeto JSON contendo o array 'eventos'.
`;

  const REVISOR_SCHEMA = {
    type: "object",
    properties: {
      eventos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            confianca: { type: "number" },
            justificativa: { type: "string" },
            pessoaFisicaId: { type: "string", description: "ID de Pessoa Física ou vazio se não houver match" },
            pessoaJuridicaId: { type: "string", description: "ID de Pessoa Jurídica ou vazio se não houver match" },
          },
          required: ["index", "confianca", "justificativa"],
        },
      },
    },
    required: ["eventos"],
  };

  const reviewerPayload = withMaxTokens({
    model: reviewerModel,
    messages: [
      {
        role: "system",
        content: "Você é um revisor crítico de conciliação bancária eleitoral que valida propostas de correspondência em formato JSON estruturado.",
      },
      {
        role: "user",
        content: promptReviewer,
      },
    ],
    response_format: buildStructuredResponseFormat(
      reviewerModel,
      "critique_match",
      REVISOR_SCHEMA as unknown as Record<string, unknown>,
    ),
  });

  try {
    const { parsed } = await callOpenRouterJson(reviewerPayload, options);
    const rawEventos = parsed.eventos;
    if (Array.isArray(rawEventos)) {
      for (const entry of rawEventos) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const index = Number(row.index);
        if (!Number.isInteger(index) || index < 0 || index >= drafts.length) {
          continue;
        }
        const target = drafts[index]!;
        const confianca = Number(row.confianca);
        target.confianca = Number.isFinite(confianca) ? Math.min(1, Math.max(0, confianca)) : target.confianca;
        target.justificativa = String(row.justificativa ?? "").trim() || target.justificativa;
        
        const pfId = String(row.pessoaFisicaId ?? "").trim();
        const pjId = String(row.pessoaJuridicaId ?? "").trim();

        if (pfId && pfId.toLowerCase() !== "null" && pfId.toLowerCase() !== "undefined") {
          target.pessoaFisicaId = pfId;
          delete target.pessoaJuridicaId;
        } else if (pjId && pjId.toLowerCase() !== "null" && pjId.toLowerCase() !== "undefined") {
          target.pessoaJuridicaId = pjId;
          delete target.pessoaFisicaId;
        } else {
          delete target.pessoaFisicaId;
          delete target.pessoaJuridicaId;
        }
      }
    }
  } catch (err) {
    console.error("Erro no modelo revisor durante a consolidação AI:", err);
  }

  return drafts;
}
