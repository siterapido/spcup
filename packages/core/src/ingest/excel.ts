import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";

import { MOVIMENTACAO_DIRECAO, type ParsedTransactionRow } from "./types";

const REQUIRED_COLUMNS = new Set(["data", "valor", "descricao"]);
const VALID_HEADERS = new Set([...REQUIRED_COLUMNS, "tipo"]);

const TIPO_ENTRADA = new Set(["C", "CREDITO", "CRÉDITO", "ENTRADA"]);
const TIPO_SAIDA = new Set(["D", "DEBITO", "DÉBITO", "SAIDA", "SAÍDA"]);

function normalizeHeader(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const key = String(value).trim().toLowerCase();
  return VALID_HEADERS.has(key) ? key : null;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  const text = String(value).trim();
  for (const [pattern, fn] of [
    [/^(\d{2})\/(\d{2})\/(\d{4})$/, (m: RegExpMatchArray) => new Date(+m[3]!, +m[2]! - 1, +m[1]!)],
    [/^(\d{4})-(\d{2})-(\d{2})$/, (m: RegExpMatchArray) => new Date(+m[1]!, +m[2]! - 1, +m[3]!)],
    [/^(\d{2})-(\d{2})-(\d{4})$/, (m: RegExpMatchArray) => new Date(+m[3]!, +m[2]! - 1, +m[1]!)],
  ] as const) {
    const match = text.match(pattern);
    if (match) {
      return fn(match);
    }
  }
  throw new Error(`Data inválida: ${String(value)}`);
}

function parseDecimal(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  let text = String(value).trim();
  if (!text) {
    throw new Error("Valor inválido: vazio");
  }
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }
  const num = Number.parseFloat(text);
  if (Number.isNaN(num)) {
    throw new Error(`Valor inválido: ${String(value)}`);
  }
  return num;
}

function directionFromTipo(
  tipo: unknown,
  amount: number,
): { direcao: ParsedTransactionRow["direcao"]; valor: string } {
  if (tipo != null && String(tipo).trim()) {
    const token = String(tipo).trim().toUpperCase();
    if (TIPO_ENTRADA.has(token)) {
      return { direcao: MOVIMENTACAO_DIRECAO.ENTRADA, valor: Math.abs(amount).toFixed(2) };
    }
    if (TIPO_SAIDA.has(token)) {
      return { direcao: MOVIMENTACAO_DIRECAO.SAIDA, valor: Math.abs(amount).toFixed(2) };
    }
    throw new Error(`Tipo inválido: ${String(tipo)}`);
  }
  if (amount >= 0) {
    return { direcao: MOVIMENTACAO_DIRECAO.ENTRADA, valor: Math.abs(amount).toFixed(2) };
  }
  return { direcao: MOVIMENTACAO_DIRECAO.SAIDA, valor: Math.abs(amount).toFixed(2) };
}

function rowIsEmpty(values: Record<string, unknown>): boolean {
  return Object.values(values).every(
    (value) => value == null || String(value).trim() === "",
  );
}

async function parseWorkbook(workbook: ExcelJS.Workbook): Promise<ParsedTransactionRow[]> {
  const sheet = workbook.worksheets[0];
  if (sheet == null) {
    return [];
  }

  const columnIndex: Record<string, number> = {};
  const rows: ParsedTransactionRow[] = [];
  let headerReady = false;

  sheet.eachRow((row) => {
    const values = row.values as unknown[];
    const cells = values.slice(1);

    if (!headerReady) {
      for (let index = 0; index < cells.length; index += 1) {
        const name = normalizeHeader(cells[index]);
        if (name != null) {
          columnIndex[name] = index;
        }
      }
      const missing = [...REQUIRED_COLUMNS].filter((col) => !(col in columnIndex));
      if (missing.length > 0) {
        throw new Error(`Colunas obrigatórias ausentes: ${missing.sort().join(", ")}`);
      }
      headerReady = true;
      return;
    }

    const record: Record<string, unknown> = {};
    for (const [name, index] of Object.entries(columnIndex)) {
      record[name] = cells[index];
    }
    if (rowIsEmpty(record)) {
      return;
    }

    const amount = parseDecimal(record.valor);
    const { direcao, valor } = directionFromTipo(record.tipo, amount);

    rows.push({
      dataMovimento: parseDate(record.data),
      valor,
      descricaoRaw: String(record.descricao ?? "").trim(),
      direcao,
      nrExtratoBancario: null,
    });
  });

  return rows;
}

export async function parseExcelBuffer(buffer: Buffer): Promise<ParsedTransactionRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
  return parseWorkbook(workbook);
}

export async function parseExcel(pathOrBuffer: string | Buffer): Promise<ParsedTransactionRow[]> {
  const buffer =
    typeof pathOrBuffer === "string" ? await readFile(pathOrBuffer) : pathOrBuffer;
  return parseExcelBuffer(buffer);
}
