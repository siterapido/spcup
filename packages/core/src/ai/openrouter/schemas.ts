import type { ExtratoColumnMap } from "../../ingest/extrato-column-map";
import { buildExtratoColumnPromptHint } from "../../ingest/extrato-column-map";
import { resolveModelProfile } from "../model-profile";
import { withMaxTokens } from "./client";

export type ExtratoPayloadOptions = {
  extratoColumnMap?: ExtratoColumnMap;
};

function appendExtratoColumnHint(
  content: string,
  options?: ExtratoPayloadOptions,
): string {
  if (!options?.extratoColumnMap) {
    return content;
  }
  const hint = buildExtratoColumnPromptHint(options.extratoColumnMap);
  return `${content}\n\n---\n${hint}\n---`;
}

export const MAX_EXTRATO_TEXT_CHARS = 24_000;

export const EXTRACTION_SCHEMA = {
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

export const EXTRATO_TRANSACTION_ITEM_SCHEMA = {
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
    documento: {
      type: ["string", "null"],
      description:
        "Número do Documento/lançamento da transação no extrato (coluna 'Documento'/'Nº Doc'); null se ausente. NÃO é CPF/CNPJ.",
    },
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
    "documento",
    "pagina",
    "indice_linha",
    "bbox",
  ],
  additionalProperties: false,
} as const;

export const EXTRATO_ARRAY_SCHEMA = {
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
  '"documento":"12345","pagina":1,"indice_linha":1,"bbox":{"x":0,"y":0,"w":1,"h":0.05}}]}. ' +
  "Analise detalhadamente cada linha e coluna. O texto extraído de tabelas pode estar fora de ordem visual: identifique e associe corretamente a data, valor e descrição de cada movimentação. " +
  "Não pule NENHUMA transação de entrada/crédito ou saída/débito visível. " +
  "cred_dev = código da coluna Cred/Dev quando existir. Use ENTRADA para crédito e SAIDA para débito. " +
  "documento = nº do lançamento/Documento do extrato; não é CPF/CNPJ. " +
  "cpf/cnpj só dígitos se visíveis; senão preencha nome. " +
  "pagina e indice_linha por transação; bbox normalizado 0-1 na página. " +
  "Não invente linhas.";

export const KIMI_EXTRATO_USER_PDF =
  "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.";

const GEMINI_EXTRATO_SYSTEM_PROMPT =
  "Você extrai transações de extrato bancário brasileiro (PDF ou texto). " +
  'Responda APENAS JSON válido no schema: {"transacoes":[{"data":"YYYY-MM-DD","valor":0,"direcao":"ENTRADA|SAIDA",' +
  '"descricao":"...","cred_dev":"...","nome":"...","cpf":"11digitos","cnpj":"14digitos",' +
  '"documento":"12345","pagina":1,"indice_linha":1,"bbox":{"x":0,"y":0,"w":1,"h":0.05}}]}. ' +
  "Analise detalhadamente cada linha e coluna. O texto extraído de tabelas pode estar fora de ordem visual: identifique e associe corretamente a data, valor e descrição de cada movimentação. " +
  "Não pule NENHUMA transação de entrada/crédito ou saída/débito visível. " +
  "cred_dev = código da coluna Cred/Dev do extrato. Use ENTRADA para crédito e SAIDA para débito. " +
  "documento = nº do lançamento/Documento do extrato; não é CPF/CNPJ. " +
  "Preencha nome com o contraparte quando visível; cpf/cnpj só dígitos. " +
  "pagina e indice_linha por transação; bbox normalizado 0-1 na página. " +
  "Não invente linhas.";

export const LINHA_SCORE_SCHEMA = {
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

export function extratoSystemPrompt(model: string): string {
  const variant = resolveModelProfile(model).extratoPromptVariant;
  return variant === "kimi" ? KIMI_EXTRATO_SYSTEM_PROMPT : GEMINI_EXTRATO_SYSTEM_PROMPT;
}

export function buildStructuredResponseFormat(
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

function encodePdf(buffer: Buffer): string {
  return `data:application/pdf;base64,${buffer.toString("base64")}`;
}

function encodePng(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

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

export function buildPayload(buffer: Buffer, filename: string, model: string): Record<string, unknown> {
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

export function buildExtratoTextPayload(
  statementText: string,
  model: string,
  options?: ExtratoPayloadOptions,
): Record<string, unknown> {
  return withMaxTokens({
    model,
    messages: [
      { role: "system", content: extratoSystemPrompt(model) },
      {
        role: "user",
        content: appendExtratoColumnHint(
          "Extraia todas as transações do texto abaixo.\n\n" +
            "---\n" +
            statementText +
            "\n---",
          options,
        ),
      },
    ],
    response_format: buildStructuredResponseFormat(
      model,
      "extrato_transacoes",
      EXTRATO_ARRAY_SCHEMA as unknown as Record<string, unknown>,
    ),
  });
}

export function buildExtratoImagePayload(
  pngBuffer: Buffer,
  filename: string,
  model: string,
  options?: ExtratoPayloadOptions,
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
            text: appendExtratoColumnHint(
              "Extraia todas as transações visíveis nesta imagem de extrato bancário. " +
                "Retorne somente o JSON.",
              options,
            ),
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

export function buildExtratoFilePayload(
  buffer: Buffer,
  filename: string,
  model: string,
  options?: ExtratoPayloadOptions,
): Record<string, unknown> {
  const pdfUserText =
    resolveModelProfile(model).extratoPromptVariant === "kimi"
      ? KIMI_EXTRATO_USER_PDF
      : "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.";
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
              text: appendExtratoColumnHint(pdfUserText, options),
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

export function trimExtratoText(statementText: string): string {
  const trimmed = statementText.trim();
  if (trimmed.length <= MAX_EXTRATO_TEXT_CHARS) {
    return trimmed;
  }
  return trimmed.slice(0, MAX_EXTRATO_TEXT_CHARS);
}
