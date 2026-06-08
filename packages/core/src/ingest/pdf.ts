import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Db, Movimentacao } from "@spc-up/db";

import {
  extractStructuredFromPdf,
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  parseExtratoValor,
  type ExtratoExtraction,
  type ExtractStructuredOptions,
} from "../ai/openrouter";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { applyDeterministicMatch } from "../match/rules";
import { normalizeName } from "../normalize";
import { extractDocumentCandidates } from "../match/rules";
import { normalizeCnpj, normalizeCpf } from "../normalize";
import { toIngestError } from "./errors";
import { ingestLog } from "./log";
import { origemFromExtratoItem } from "../provenance/attach-extracao";
import { getPdfPageCount } from "./pdf-split";
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

export function credDevFromExtratoItem(item: Record<string, unknown>): string | null {
  const raw = String(item.cred_dev ?? item.credDev ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/** Número de documento/lançamento do extrato (coluna Documento da Caixa etc.), não CPF/CNPJ. */
export function nrExtratoBancarioFromExtratoItem(item: Record<string, unknown>): string | null {
  const raw = String(item.documento ?? item.nr_documento ?? item.nrDocumento ?? "").trim();
  if (!raw || /^null$/i.test(raw)) {
    return null;
  }
  return raw.slice(0, 64);
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

  const text = [item.descricao, item.nome]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
  const candidates = extractDocumentCandidates(text);
  if (candidates.length === 1) {
    const doc = candidates[0]!;
    return doc.docType === "CPF"
      ? `CPF ${doc.normalized}`
      : `CNPJ ${doc.normalized}`;
  }

  return null;
}

function rowFromExtratoItemSemDoc(item: Record<string, unknown>): ParsedTransactionRow | null {
  const rd =
    item.remetente_destinatario != null ? String(item.remetente_destinatario).trim() : "";
  if (rd.length < 3) {
    return null;
  }

  const valorNum = parseExtratoValor(item.valor);
  if (Number.isNaN(valorNum)) {
    return null;
  }

  const direcao = String(item.direcao).trim().toUpperCase() as MovimentacaoDirecao;
  if (direcao !== MOVIMENTACAO_DIRECAO.ENTRADA && direcao !== MOVIMENTACAO_DIRECAO.SAIDA) {
    return null;
  }

  const descricao = String(item.descricao ?? "").trim();
  const descricaoRaw = descricao || rd;
  return {
    dataMovimento: parseExtractionDate(String(item.data)),
    valor: Math.abs(valorNum).toFixed(2),
    descricaoRaw,
    direcao,
    credDev: credDevFromExtratoItem(item),
    nrExtratoBancario: nrExtratoBancarioFromExtratoItem(item),
    remetenteDestinatario: normalizeName(rd),
  };
}

/** Build a parsed row from an extrato line; `docLabel` is appended to description (no fake CPF in memo). */
export function rowFromExtratoItem(
  item: Record<string, unknown>,
  docLabel: string,
): ParsedTransactionRow {
  const valorNum = parseExtratoValor(item.valor);
  if (Number.isNaN(valorNum)) {
    throw new Error(`Valor invalido: ${String(item.valor)}`);
  }

  const direcao = String(item.direcao).trim().toUpperCase() as MovimentacaoDirecao;
  if (direcao !== MOVIMENTACAO_DIRECAO.ENTRADA && direcao !== MOVIMENTACAO_DIRECAO.SAIDA) {
    throw new Error(`Direcao invalida: ${direcao}`);
  }

  const nome = item.nome != null ? String(item.nome).trim() : "";
  const descricao = String(item.descricao ?? "").trim();
  let descricaoRaw = "";
  if (descricao && nome) {
    if (descricao.toUpperCase().includes(nome.toUpperCase())) {
      descricaoRaw = `${descricao} ${docLabel}`;
    } else {
      descricaoRaw = `${descricao} ${nome} ${docLabel}`;
    }
  } else if (nome) {
    descricaoRaw = `${nome} ${docLabel}`;
  } else if (descricao) {
    descricaoRaw = `${descricao} ${docLabel}`;
  } else {
    descricaoRaw = docLabel;
  }

  const rd =
    item.remetente_destinatario != null ? String(item.remetente_destinatario).trim() : "";

  return {
    dataMovimento: parseExtractionDate(String(item.data)),
    valor: Math.abs(valorNum).toFixed(2),
    descricaoRaw,
    direcao,
    credDev: credDevFromExtratoItem(item),
    nrExtratoBancario: nrExtratoBancarioFromExtratoItem(item),
    remetenteDestinatario: rd.length >= 3 ? normalizeName(rd) : null,
  };
}

export type RowsFromExtratoOptions = {
  attachOrigem: boolean;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pageCount: number;
};

function withOrigem(
  row: ParsedTransactionRow,
  item: Record<string, unknown>,
  opts: RowsFromExtratoOptions,
): ParsedTransactionRow {
  if (!opts.attachOrigem) {
    return row;
  }
  const batchPagina = Number(item.__batch_pagina ?? 1);
  const origemExtracao = origemFromExtratoItem(item, {
    arquivoIngestaoId: opts.arquivoIngestaoId,
    nomeArquivo: opts.nomeArquivo,
    batchPagina: Number.isFinite(batchPagina) && batchPagina >= 1 ? batchPagina : 1,
    pageCount: opts.pageCount,
  });
  return { ...row, origemExtracao };
}

/** Map extrato AI output to rows; lines without valid CPF/CNPJ increment `linhasIgnoradasSemDoc`. */
export function rowsFromExtratoTransactions(
  extraction: ExtratoExtraction,
  opts?: RowsFromExtratoOptions,
): {
  rows: ParsedTransactionRow[];
  linhasIgnoradasSemDoc: number;
} {
  let linhasIgnoradasSemDoc = 0;
  const rows: ParsedTransactionRow[] = [];

  for (const item of extraction.transacoes) {
    try {
      const docLabel = docLabelFromExtratoItem(item);
      if (docLabel != null) {
        rows.push(
          opts
            ? withOrigem(rowFromExtratoItem(item, docLabel), item, opts)
            : rowFromExtratoItem(item, docLabel),
        );
        continue;
      }
      const semDoc = rowFromExtratoItemSemDoc(item);
      if (semDoc != null) {
        rows.push(opts ? withOrigem(semDoc, item, opts) : semDoc);
        continue;
      }
      linhasIgnoradasSemDoc += 1;
    } catch {
      linhasIgnoradasSemDoc += 1;
    }
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
  const t0 = Date.now();

  ingestLog("info", { fase: "inicio", arquivoId, filename });

  try {
    ingestLog("info", { fase: "pdf_text", arquivoId, filename });
    const { text, hasEnoughText } = await extractPdfText(buffer);
    ingestLog("info", {
      fase: "pdf_text",
      arquivoId,
      filename,
      duracaoMs: Date.now() - t0,
    });

    const extraction = hasEnoughText
      ? await extractTransactionsFromPdfText(text, { ...options, filename })
      : await extractTransactionsFromPdfFile(buffer, { ...options, filename });

    if (!hasEnoughText && extraction.transacoes.length === 0) {
      throw new Error(
        "Não foi possível extrair transações do PDF (scan ou formato não suportado).",
      );
    }

    ingestLog("info", {
      fase: hasEnoughText ? "openrouter_text" : "openrouter_vision",
      arquivoId,
      filename,
      transacoesExtraidas: extraction.transacoes.length,
    });

    const pageCount = await getPdfPageCount(buffer);
    const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(extraction, {
      attachOrigem: !hasEnoughText,
      arquivoIngestaoId: arquivoId,
      nomeArquivo: filename,
      pageCount,
    });

    if (rows.length === 0) {
      ingestLog("info", { fase: "concluido", arquivoId, filename, duracaoMs: Date.now() - t0 });
      return { movimentacoes: [], linhasIgnoradasSemDoc };
    }

    const created = await persistTransactions(db, uf, exercicio, arquivoId, rows, prestador);

    const movimentacoes: Movimentacao[] = [];
    for (const movimentacao of created) {
      movimentacoes.push(await applyDeterministicMatch(db, movimentacao.id));
    }

    ingestLog("info", { fase: "concluido", arquivoId, filename, duracaoMs: Date.now() - t0 });
    return { movimentacoes, linhasIgnoradasSemDoc };
  } catch (error) {
    const ingErr = toIngestError(error);
    ingestLog("error", {
      fase: "pdf_text",
      arquivoId,
      filename,
      codigoErro: ingErr.detail.codigo,
      causa: ingErr.detail.causaTecnica,
    });
    throw ingErr;
  }
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

  const descricaoRaw = `${nome} CPF ${cpf}`;
  const rd =
    extracted.remetente_destinatario != null
      ? String(extracted.remetente_destinatario).trim()
      : "";
  return {
    dataMovimento: parseExtractionDate(String(extracted.data)),
    valor: Math.abs(valorNum).toFixed(2),
    descricaoRaw,
    direcao,
    credDev: null,
    nrExtratoBancario: null,
    remetenteDestinatario: rd.length >= 3 ? normalizeName(rd) : null,
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
