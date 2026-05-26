import { readFile } from "node:fs/promises";

import type { Db, Movimentacao } from "@spc-up/db";
import { movimentacao } from "@spc-up/db";

import { computeHashMovimento } from "./hash";
import {
  MOVIMENTACAO_DIRECAO,
  MOVIMENTACAO_STATUS,
  TIPO_PRESTADOR,
  type ParsedTransactionRow,
  type PrestadorContext,
} from "./types";

export { computeHashMovimento } from "./hash";

function parseOfxDate(raw: string): Date {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length !== 8) {
    throw new Error(`Data OFX inválida: ${raw}`);
  }
  const y = Number.parseInt(digits.slice(0, 4), 10);
  const m = Number.parseInt(digits.slice(4, 6), 10);
  const d = Number.parseInt(digits.slice(6, 8), 10);
  return new Date(Date.UTC(y, m - 1, d));
}

function directionFromAmount(amount: number): {
  direcao: ParsedTransactionRow["direcao"];
  valor: string;
} {
  if (amount >= 0) {
    return { direcao: MOVIMENTACAO_DIRECAO.ENTRADA, valor: Math.abs(amount).toFixed(2) };
  }
  return { direcao: MOVIMENTACAO_DIRECAO.SAIDA, valor: Math.abs(amount).toFixed(2) };
}

function readTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i");
  const match = block.match(re);
  return match?.[1]?.trim() ?? null;
}

export function parseOfxBuffer(buffer: Buffer): ParsedTransactionRow[] {
  const content = buffer.toString("utf8");
  const rows: ParsedTransactionRow[] = [];

  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const amountRaw = readTag(block, "TRNAMT");
    const dateRaw = readTag(block, "DTPOSTED");
    if (amountRaw == null || dateRaw == null) {
      continue;
    }

    const amount = Number.parseFloat(amountRaw);
    if (Number.isNaN(amount)) {
      throw new Error(`Valor OFX inválido: ${amountRaw}`);
    }

    const { direcao, valor } = directionFromAmount(amount);
    const memo = readTag(block, "MEMO");
    const payee = readTag(block, "NAME");
    const descricaoRaw = (payee || memo || "").trim();
    const fitid = readTag(block, "FITID");

    rows.push({
      dataMovimento: parseOfxDate(dateRaw),
      valor,
      descricaoRaw,
      direcao,
      nrExtratoBancario: fitid,
    });
  }

  return rows;
}

/** Parse an OFX file into normalized transaction rows. */
export async function parseOfx(pathOrBuffer: string | Buffer): Promise<ParsedTransactionRow[]> {
  const buffer =
    typeof pathOrBuffer === "string" ? await readFile(pathOrBuffer) : pathOrBuffer;
  return parseOfxBuffer(buffer);
}

/** Persist parsed rows as draft movimentacoes with deduplication hashes. */
export async function persistTransactions(
  db: Db,
  uf: string,
  exercicio: number,
  arquivoId: string,
  rows: ParsedTransactionRow[],
  prestador: PrestadorContext,
): Promise<Movimentacao[]> {
  const created: Movimentacao[] = [];
  const ufUpper = uf.toUpperCase();

  for (const row of rows) {
    const [mov] = await db
      .insert(movimentacao)
      .values({
        uf: ufUpper,
        exercicio,
        dataMovimento: row.dataMovimento.toISOString().slice(0, 10),
        valor: row.valor,
        descricaoRaw: row.descricaoRaw,
        direcao: row.direcao,
        nrExtratoBancario: row.nrExtratoBancario,
        arquivoIngestaoId: arquivoId,
        sessaoPrestacaoId: prestador.sessaoPrestacaoId,
        cnpjPrestador: prestador.cnpjPrestador,
        tipoPrestador: prestador.tipoPrestador,
        diretorioMunicipalId: prestador.diretorioMunicipalId,
        status: MOVIMENTACAO_STATUS.RASCUNHO,
        hashMovimento: computeHashMovimento(prestador.cnpjPrestador, exercicio, row),
      })
      .returning();

    if (mov) {
      created.push(mov);
    }
  }

  return created;
}
