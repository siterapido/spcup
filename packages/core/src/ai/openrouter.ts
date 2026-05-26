import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  dedupeExtratoTransactions,
  getPdfPageCount,
  shouldBatchPdfVision,
  splitPdfIntoBatches,
} from "../ingest/pdf-split";
import {
  readExtratoPdfCache,
  readExtratoTextCache,
  writeExtratoPdfCache,
  writeExtratoTextCache,
} from "./openrouter-cache";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PDF_TIMEOUT_MS = 180_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;
/** Cap model output size (extrato lists are bounded; saves cost on runaway completions). */
const DEFAULT_MAX_TOKENS = 8192;
/** Text-path statements above this are truncated before the API call. */
export const MAX_EXTRATO_TEXT_CHARS = 24_000;
const DEFAULT_PDF_MODEL = "moonshotai/kimi-k2.6";

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
    cpf: { type: "string", description: "CPF digits only when present" },
    cnpj: { type: "string", description: "CNPJ digits only when present" },
    nome: { type: "string", description: "Counterparty name when present" },
  },
  required: ["data", "valor", "direcao", "descricao"],
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

const EXTRATO_SYSTEM_PROMPT =
  "Extrato bancário BR. JSON transacoes: data (YYYY-MM-DD), valor, direcao (ENTRADA|SAIDA), descricao. " +
  "Preencha cpf/cnpj (só dígitos) quando aparecer na linha; senão nome do contraparte. Não invente linhas.";

const KIMI_EXTRATO_SYSTEM_PROMPT =
  "Você extrai transações de extrato bancário brasileiro (PDF ou texto). " +
  'Responda APENAS JSON: {"transacoes":[{"data":"YYYY-MM-DD","valor":0,"direcao":"ENTRADA|SAIDA",' +
  '"descricao":"...","nome":"...","cpf":"11digitos","cnpj":"14digitos"}]}. ' +
  "Use ENTRADA para crédito e SAIDA para débito. cpf/cnpj só dígitos se visíveis; senão preencha nome. " +
  "Não invente linhas.";

const KIMI_EXTRATO_USER_PDF =
  "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.";

export interface ExtractStructuredOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
  filename?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Kimi on OpenRouter works better with json_object + schema in prompt (not strict json_schema). */
export function isKimiModel(model: string): boolean {
  return /kimi/i.test(model);
}

function extratoSystemPrompt(model: string): string {
  return isKimiModel(model) ? KIMI_EXTRATO_SYSTEM_PROMPT : EXTRATO_SYSTEM_PROMPT;
}

function buildStructuredResponseFormat(
  model: string,
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (isKimiModel(model)) {
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
  return { ...payload, max_tokens: resolveMaxTokens() };
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

function buildExtratoFilePayload(
  buffer: Buffer,
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
            text: isKimiModel(model) ? KIMI_EXTRATO_USER_PDF : "Extract all bank transactions from this PDF bank statement.",
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
  });
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
  return options?.model ?? process.env.OPENROUTER_PDF_MODEL ?? DEFAULT_PDF_MODEL;
}

function normalizeExtratoResponse(parsed: Record<string, unknown>): ExtratoExtraction {
  const raw = parsed.transacoes;
  if (!Array.isArray(raw)) {
    return { transacoes: [] };
  }

  return {
    transacoes: raw.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : {},
    ),
  };
}

async function callOpenRouterJson(
  payload: Record<string, unknown>,
  options?: ExtractStructuredOptions,
): Promise<Record<string, unknown>> {
  const apiKey = options?.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

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
        return parseResponseBody(body);
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
  const model = options?.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4";
  const { buffer, filename } = await resolvePdfInput(pathOrBuffer, options?.filename);
  const payload = buildPayload(buffer, filename, model);
  return callOpenRouterJson(payload, options);
}

export async function extractTransactionsFromPdfText(
  statementText: string,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  const normalized = trimExtratoText(statementText);
  const cached = await readExtratoTextCache(normalized, model);
  if (cached) {
    return normalizeExtratoResponse(cached);
  }

  const payload = buildExtratoTextPayload(normalized, model);
  const parsed = await callOpenRouterJson(payload, options);
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoTextCache(normalized, model, extraction);
  return extraction;
}

async function extractTransactionsFromSinglePdfBuffer(
  buffer: Buffer,
  options: ExtractStructuredOptions | undefined,
  model: string,
  filename: string,
): Promise<ExtratoExtraction> {
  const cached = await readExtratoPdfCache(buffer, model);
  if (cached) {
    return normalizeExtratoResponse(cached);
  }

  const payload = buildExtratoFilePayload(buffer, filename, model);
  const parsed = await callOpenRouterJson(payload, {
    ...options,
    timeoutMs: options?.timeoutMs ?? resolvePdfTimeoutMs(),
  });
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}

export async function extractTransactionsFromPdfFile(
  buffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  const fullCached = await readExtratoPdfCache(buffer, model);
  if (fullCached) {
    return normalizeExtratoResponse(fullCached);
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
    merged.push(...part.transacoes);
  }

  const extraction: ExtratoExtraction = {
    transacoes: dedupeExtratoTransactions(merged),
  };
  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}
