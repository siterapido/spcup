import type { Db, Movimentacao } from "@spc-up/db";

import { extractStructuredFromPdf } from "../ai/openrouter";
import { applyDeterministicMatch } from "../match/rules";
import { persistTransactions } from "./ofx";
import {
  MOVIMENTACAO_DIRECAO,
  type MovimentacaoDirecao,
  type ParsedTransactionRow,
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
): Promise<Movimentacao[]> {
  const extracted = await extractStructuredFromPdf(pathOrBuffer);
  const row = rowFromExtraction(extracted);
  const created = await persistTransactions(db, uf, exercicio, arquivoId, [row]);

  const matched: Movimentacao[] = [];
  for (const movimentacao of created) {
    matched.push(await applyDeterministicMatch(db, movimentacao.id));
  }
  return matched;
}
