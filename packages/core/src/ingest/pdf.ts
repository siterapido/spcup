import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Db, Movimentacao } from "@spc-up/db";

import {
  extractStructuredFromPdf,
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  type ExtratoExtraction,
  type ExtractStructuredOptions,
} from "../ai/openrouter";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { normalizeCnpj, normalizeCpf } from "../normalize";
import { extractPdfText } from "./pdf-text";
import { persistTransactions } from "./ofx";
import {
  MOVIMENTACAO_DIRECAO,
  type MovimentacaoDirecao,
  type ParsedTransactionRow,
  type PrestadorContext,
} from "./types";

function parseExtractionDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    throw new Error(`Data invalida: ${value}`);
  }
  const y = Number.parseInt(match[1]!, 10);
  const m = Number.parseInt(match[2]!, 10);
  const d = Number.parseInt(match[3]!, 10);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Result of ingesting a bank-statement PDF (extrato) with doc validation (regra B). */
export interface IngestPdfExtratoResult {
  movimentacoes: Movimentacao[];
  linhasIgnoradasSemDoc: number;
}

function docLabelFromExtratoItem(item: Record<string, unknown>): string | null {
  const cpfStr = item.cpf != null ? String(item.cpf).trim() : "";
  if (cpfStr) {
    try {
      return `CPF ${normalizeCpf(cpfStr)}`;
    } catch {
      // try CNPJ
    }
  }
  const cnpjStr = item.cnpj != null ? String(item.cnpj).trim() : "";
  if (cnpjStr) {
    try {
      return `CNPJ ${normalizeCnpj(cnpjStr)}`;
    } catch {
      return null;
    }
  }
  return null;
}

/** Build a parsed row from an extrato line; `docLabel` is appended to description (no fake CPF in memo). */
export function rowFromExtratoItem(
  item: Record<string, unknown>,
  docLabel: string,
): ParsedTransactionRow {
  const valorNum = Number(item.valor);
  if (Number.isNaN(valorNum)) {
    throw new Error(`Valor invalido: ${String(item.valor)}`);
  }

  const direcao = String(item.direcao).trim().toUpperCase() as MovimentacaoDirecao;
  if (direcao !== MOVIMENTACAO_DIRECAO.ENTRADA && direcao !== MOVIMENTACAO_DIRECAO.SAIDA) {
    throw new Error(`Direcao invalida: ${direcao}`);
  }

  const descricao = String(item.descricao ?? "").trim();
  const descricaoRaw = descricao.length > 0 ? `${descricao} ${docLabel}` : docLabel;

  return {
    dataMovimento: parseExtractionDate(String(item.data)),
    valor: Math.abs(valorNum).toFixed(2),
    descricaoRaw,
    direcao,
    nrExtratoBancario: null,
  };
}

/** Map extrato AI output to rows; lines without valid CPF/CNPJ increment `linhasIgnoradasSemDoc`. */
export function rowsFromExtratoTransactions(extraction: ExtratoExtraction): {
  rows: ParsedTransactionRow[];
  linhasIgnoradasSemDoc: number;
} {
  let linhasIgnoradasSemDoc = 0;
  const rows: ParsedTransactionRow[] = [];

  for (const item of extraction.transacoes) {
    const docLabel = docLabelFromExtratoItem(item);
    if (docLabel == null) {
      linhasIgnoradasSemDoc += 1;
      continue;
    }
    rows.push(rowFromExtratoItem(item, docLabel));
  }

  return { rows, linhasIgnoradasSemDoc };
}

async function resolvePdfBuffer(
  pathOrBuffer: string | Buffer,
  filenameHint: string | undefined,
): Promise<{ buffer: Buffer; filename: string }> {
  if (Buffer.isBuffer(pathOrBuffer)) {
    return {
      buffer: pathOrBuffer,
      filename: filenameHint ?? "document.pdf",
    };
  }
  const buffer = await readFile(pathOrBuffer);
  return {
    buffer,
    filename: filenameHint ?? path.basename(pathOrBuffer),
  };
}

/** Extract extrato PDF: text-first AI, persist rows with regra B (CPF/CNPJ obrigatório). */
export async function ingestPdfExtrato(
  db: Db,
  uf: string,
  exercicio: number,
  arquivoId: string,
  pathOrBuffer: string | Buffer,
  prestador: PrestadorContext,
  options?: ExtractStructuredOptions,
): Promise<IngestPdfExtratoResult> {
  const { buffer, filename } = await resolvePdfBuffer(pathOrBuffer, options?.filename);

  const { text, hasEnoughText } = await extractPdfText(buffer);
  const extraction = hasEnoughText
    ? await extractTransactionsFromPdfText(text, { ...options, filename })
    : await extractTransactionsFromPdfFile(buffer, { ...options, filename });

  const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(extraction);

  if (rows.length === 0) {
    return { movimentacoes: [], linhasIgnoradasSemDoc };
  }

  const created = await persistTransactions(db, uf, exercicio, arquivoId, rows, prestador);

  const movimentacoes: Movimentacao[] = [];
  for (const movimentacao of created) {
    movimentacoes.push(await applyAiMatchToMovimentacao(db, movimentacao.id));
  }

  return { movimentacoes, linhasIgnoradasSemDoc };
}

/** Map OpenRouter extraction JSON to a normalized ingest row. */
export function rowFromExtraction(
  extracted: Record<string, unknown>,
): ParsedTransactionRow {
  const cpf = String(extracted.cpf).trim();
  const nome = String(extracted.nome).trim();
  const valorNum = Number(extracted.valor);
  if (Number.isNaN(valorNum)) {
    throw new Error(`Valor invalido: ${String(extracted.valor)}`);
  }

  const direcao = String(extracted.direcao).trim().toUpperCase() as MovimentacaoDirecao;
  if (direcao !== MOVIMENTACAO_DIRECAO.ENTRADA && direcao !== MOVIMENTACAO_DIRECAO.SAIDA) {
    throw new Error(`Direcao invalida: ${direcao}`);
  }

  return {
    dataMovimento: parseExtractionDate(String(extracted.data)),
    valor: Math.abs(valorNum).toFixed(2),
    descricaoRaw: `${nome} CPF ${cpf}`,
    direcao,
    nrExtratoBancario: null,
  };
}

/** Extract PDF data with OpenRouter, persist movimentacao, and run match rules. */
export async function ingestPdf(
  db: Db,
  uf: string,
  exercicio: number,
  arquivoId: string,
  pathOrBuffer: string | Buffer,
  prestador: PrestadorContext,
): Promise<Movimentacao[]> {
  const extracted = await extractStructuredFromPdf(pathOrBuffer);
  const row = rowFromExtraction(extracted);
  const created = await persistTransactions(
    db,
    uf,
    exercicio,
    arquivoId,
    [row],
    prestador,
  );

  const matched: Movimentacao[] = [];
  for (const movimentacao of created) {
    matched.push(await applyAiMatchToMovimentacao(db, movimentacao.id));
  }
  return matched;
}
