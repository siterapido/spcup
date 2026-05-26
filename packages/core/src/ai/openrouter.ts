import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000;

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
  "You extract bank statement transactions from Brazilian financial documents (PDF or plain text). " +
  "Return every distinct transaction row: data (YYYY-MM-DD), valor (BRL amount as number), " +
  "direcao (ENTRADA for credits, SAIDA for debits), and descricao (concise description). " +
  "Include cpf, cnpj, or nome only when clearly present in the source. " +
  "Normalize CPF/CNPJ to digits only. Do not invent transactions.";

export interface ExtractStructuredOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
  filename?: string;
  sleep?: (ms: number) => Promise<void>;
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

function buildPayload(buffer: Buffer, filename: string, model: string): Record<string, unknown> {
  return {
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
  };
}

function buildExtratoTextPayload(statementText: string, model: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: EXTRATO_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Extract all bank transactions from the following statement text.\n\n" +
          "---\n" +
          statementText +
          "\n---",
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "extrato_transacoes",
        strict: true,
        schema: EXTRATO_ARRAY_SCHEMA,
      },
    },
  };
}

function buildExtratoFilePayload(
  buffer: Buffer,
  filename: string,
  model: string,
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: EXTRATO_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract all bank transactions from this PDF bank statement.",
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
        name: "extrato_transacoes",
        strict: true,
        schema: EXTRATO_ARRAY_SCHEMA,
      },
    },
  };
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
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenRouter response content is not valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
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
  return (
    options?.model ??
    process.env.OPENROUTER_PDF_MODEL ??
    "anthropic/claude-sonnet-4"
  );
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

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
      try {
        const response = await fetchFn(OPENROUTER_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`OpenRouter HTTP ${response.status}`);
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
  const payload = buildExtratoTextPayload(statementText, model);
  const parsed = await callOpenRouterJson(payload, options);
  return normalizeExtratoResponse(parsed);
}

export async function extractTransactionsFromPdfFile(
  buffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  const filename = options?.filename ?? "document.pdf";
  const payload = buildExtratoFilePayload(buffer, filename, model);
  const parsed = await callOpenRouterJson(payload, options);
  return normalizeExtratoResponse(parsed);
}
