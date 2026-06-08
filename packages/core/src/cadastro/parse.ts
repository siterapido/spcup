import ExcelJS from "exceljs";

import {
  normalizeCnpj,
  normalizeCpfDigitsOnly,
  normalizeName,
} from "../normalize";
import { parseCadastroTipo } from "./constants";
import type {
  CadastroColumnMap,
  CadastroRow,
  ParseCadastroResult,
  SpreadsheetHeadersResult,
} from "./types";

type CadastroField = "tipo" | "documento" | "nome";
type RequiredCadastroField = "documento" | "nome";

const REQUIRED_FIELDS: RequiredCadastroField[] = ["documento", "nome"];

const HEADER_ALIASES: Record<string, CadastroField> = {
  tipo: "tipo",
  type: "tipo",
  pf_pj: "tipo",
  pessoa: "tipo",
  pessoa_tipo: "tipo",
  tipo_pessoa: "tipo",
  documento: "documento",
  doc: "documento",
  cpf: "documento",
  cnpj: "documento",
  cpf_cnpj: "documento",
  cpfcnpj: "documento",
  nr_cpf_cnpj: "documento",
  cnpj_cpf: "documento",
  doc_cpf_cnpj: "documento",
  documento_cpf_cnpj: "documento",
  nr_documento: "documento",
  n_documento: "documento",
  no_documento: "documento",
  num_documento: "documento",
  numero_documento: "documento",
  nome: "nome",
  name: "nome",
  razao_social: "nome",
  razao: "nome",
  nome_completo: "nome",
  nome_razao: "nome",
  nome_razao_social: "nome",
};

function normalizeHeaderKey(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function matchHeaderToField(header: unknown): CadastroField | null {
  const key = normalizeHeaderKey(header);
  if (!key) {
    return null;
  }
  return HEADER_ALIASES[key] ?? null;
}

const SYNTHETIC_CADASTRO_HEADERS = ["nome", "documento", "tipo"] as const;

/** Excel cell → text; restores leading zeros stripped from numeric CPF/CNPJ. */
export function cellToText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const digits = String(Math.trunc(Math.abs(value)));
    if (digits.length >= 7 && digits.length <= 10) {
      return digits.padStart(11, "0");
    }
    if (digits.length >= 12 && digits.length <= 13) {
      return digits.padStart(14, "0");
    }
    return digits;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object") {
    const rich = value as {
      richText?: Array<{ text: string }>;
      text?: string;
      result?: unknown;
    };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text).join("").trim();
    }
    if (typeof rich.text === "string") {
      return rich.text.trim();
    }
    if (rich.result != null) {
      return cellToText(rich.result);
    }
  }
  let s = String(value).trim();
  if (/^[+-]?\d+[,.]?\d*[eE][+-]?\d+$/.test(s)) {
    const n = Number.parseFloat(s.replace(",", "."));
    if (Number.isFinite(n)) {
      return cellToText(Math.trunc(Math.abs(n)));
    }
  }
  if (/^[0-9]+[,.]0+$/.test(s)) {
    s = s.replace(/[,.]0+$/, "");
  }
  return s;
}

export function prepareDocumentoRaw(
  raw: string,
  explicitTipo?: "PF" | "PJ",
): { tipo: "PF" | "PJ"; documento: string } {
  let text = cellToText(raw).replace(/[\s\u00A0\u2007\u202F]+/g, "");
  text = text.replace(/^(cpf|cnpj)\s*[:#.]?\s*/i, "");
  if (/^[0-9]+[,.]0+$/.test(text)) {
    text = text.replace(/[,.]0+$/, "");
  }
  let clean = text.replace(/[^A-Za-z0-9]/g, "");
  if (!clean) {
    throw new Error("Documento vazio");
  }

  let tipo = explicitTipo ?? null;
  if (tipo == null) {
    if (clean.length <= 11) tipo = "PF";
    else if (clean.length <= 14) tipo = "PJ";
    else throw new Error("Documento com tamanho inválido");
  }

  if (tipo === "PF") {
    clean = clean.replace(/\D/g, "");
    if (clean.length > 11) {
      throw new Error("Documento com tamanho inválido");
    }
    clean = clean.padStart(11, "0");
  } else {
    clean = clean.toUpperCase();
    if (clean.length > 14) {
      throw new Error("Documento com tamanho inválido");
    }
    if (/^\d+$/.test(clean)) {
      if (clean.length < 12) {
        throw new Error("Documento com tamanho inválido");
      }
      clean = clean.padStart(14, "0");
    }
  }

  return { tipo, documento: clean };
}

function cellLooksLikeName(value: unknown): boolean {
  const text = cellToText(value);
  if (text.length < 2 || cellLooksLikeDocument(value)) {
    return false;
  }
  return /[A-Za-zÀ-ÿ]/.test(text);
}

function cellLooksLikeDocument(value: unknown): boolean {
  const text = cellToText(value);
  if (!text) {
    return false;
  }
  try {
    const prepared = prepareDocumentoRaw(text);
    if (prepared.tipo === "PF") {
      normalizeCpfDigitsOnly(prepared.documento);
    } else {
      normalizeCnpj(prepared.documento);
    }
    return true;
  } catch {
    return false;
  }
}

/** True when row 1 looks like a person row (CPF/CNPJ present), not column titles. */
export function isHeaderlessCadastroRow(cells: unknown[]): boolean {
  const values = cells
    .map((cell) => (cell == null ? "" : String(cell).trim()))
    .filter((cell) => cell.length > 0);
  if (values.length < 2) {
    return false;
  }
  const auto = suggestCadastroColumnMap(values);
  if (auto.documento != null || auto.nome != null) {
    return false;
  }
  return values.some((value) => cellLooksLikeDocument(value));
}

function positionalColumnIndex(
  columnCount: number,
): Record<CadastroField, number | undefined> {
  return {
    nome: 0,
    documento: 1,
    tipo: columnCount >= 3 ? 2 : undefined,
  };
}

/** Headerless sheets may be nome|documento or documento|nome — infer from first row. */
export function inferHeaderlessColumnIndex(
  cells: unknown[],
): Record<CadastroField, number | undefined> {
  const fallback = positionalColumnIndex(cells.length);
  if (cells.length < 2) {
    return fallback;
  }

  const docAt0 = cellLooksLikeDocument(cells[0]);
  const docAt1 = cellLooksLikeDocument(cells[1]);
  const nameAt0 = cellLooksLikeName(cells[0]);
  const nameAt1 = cellLooksLikeName(cells[1]);

  if (docAt0 && nameAt1 && !docAt1) {
    return {
      documento: 0,
      nome: 1,
      tipo: cells.length >= 3 ? 2 : undefined,
    };
  }
  if (docAt1 && nameAt0 && !docAt0) {
    return fallback;
  }

  return fallback;
}

function syntheticHeaders(columnCount: number): string[] {
  const base: string[] = [...SYNTHETIC_CADASTRO_HEADERS];
  while (base.length < columnCount) {
    base.push(`coluna_${base.length + 1}`);
  }
  return base.slice(0, columnCount);
}

export function suggestCadastroColumnMap(
  headers: string[],
): Partial<CadastroColumnMap> {
  const map: Partial<CadastroColumnMap> = {};
  for (const header of headers) {
    const field = matchHeaderToField(header);
    if (field != null && map[field] == null) {
      map[field] = header;
    }
  }
  return map;
}

function findHeaderIndex(headers: string[], target: string): number | null {
  const trimmed = target.trim();
  const normalized = normalizeHeaderKey(target);
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index] ?? "";
    if (header.trim() === trimmed || normalizeHeaderKey(header) === normalized) {
      return index;
    }
  }
  return null;
}

function buildColumnIndex(
  headers: string[],
  columnMap?: CadastroColumnMap,
): Record<CadastroField, number | undefined> {
  if (columnMap) {
    const result: Record<CadastroField, number | undefined> = {
      tipo: undefined,
      documento: undefined,
      nome: undefined,
    };

    for (const field of REQUIRED_FIELDS) {
      const index = findHeaderIndex(headers, columnMap[field]);
      if (index == null) {
        throw new Error(`Coluna mapeada não encontrada: ${columnMap[field]} (${field})`);
      }
      result[field] = index;
    }

    if (columnMap.tipo) {
      const index = findHeaderIndex(headers, columnMap.tipo);
      if (index == null) {
        throw new Error(`Coluna mapeada não encontrada: ${columnMap.tipo} (tipo)`);
      }
      result.tipo = index;
    }

    return result;
  }

  const auto: Record<CadastroField, number | undefined> = {
    tipo: undefined,
    documento: undefined,
    nome: undefined,
  };

  headers.forEach((header, index) => {
    const field = matchHeaderToField(header);
    if (field != null && auto[field] == null) {
      auto[field] = index;
    }
  });

  const missing = REQUIRED_FIELDS.filter((field) => auto[field] == null);
  if (missing.length > 0) {
    throw new Error(
      `Colunas obrigatórias ausentes: ${missing.sort().join(", ")}. Mapeie manualmente.`,
    );
  }

  return auto;
}

function inferTipoFromDocumento(documentoRaw: string): "PF" | "PJ" | null {
  try {
    return prepareDocumentoRaw(documentoRaw).tipo;
  } catch {
    return null;
  }
}

function normalizeDocumento(tipo: "PF" | "PJ", raw: string): string {
  return tipo === "PF" ? normalizeCpfDigitsOnly(raw) : normalizeCnpj(raw);
}

function parseRow(
  linha: number,
  record: Record<string, unknown>,
): { ok?: CadastroRow; erro?: string } {
  const tipoRaw = String(record.tipo ?? "").trim();
  const documentoRaw = cellToText(record.documento);
  const nomeRaw = cellToText(record.nome);
  if (!documentoRaw) {
    return { erro: "Documento vazio" };
  }
  if (!nomeRaw) {
    return { erro: "Nome vazio" };
  }

  let tipo = tipoRaw ? parseCadastroTipo(tipoRaw) : null;
  if (tipoRaw && tipo == null) {
    return { erro: `Tipo inválido: ${tipoRaw}` };
  }

  try {
    const prepared = prepareDocumentoRaw(documentoRaw, tipo ?? undefined);
    tipo = prepared.tipo;
    const documento = normalizeDocumento(tipo, prepared.documento);
    const nome = normalizeName(nomeRaw);
    return { ok: { linha, tipo, documento, nome } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { erro: message };
  }
}

function rowCells(values: unknown[]): unknown[] {
  return values.slice(1);
}

/** Prefer Excel formatted text (preserves masks / leading zeros). */
function readExcelRowCells(row: ExcelJS.Row, columnCount: number): unknown[] {
  const cells: unknown[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    const cell = row.getCell(index + 1);
    const text = cell.text?.trim();
    if (text) {
      cells.push(text);
    } else {
      cells.push(cell.value ?? null);
    }
  }
  return cells;
}

function parseRowsFromSheet(
  headers: string[],
  rows: unknown[][],
  columnIndex: Record<CadastroField, number | undefined>,
  firstDataLine = 2,
): ParseCadastroResult {
  const ok: CadastroRow[] = [];
  const erros: ParseCadastroResult["erros"] = [];

  for (let rowOffset = 0; rowOffset < rows.length; rowOffset += 1) {
    const linha = rowOffset + firstDataLine;
    const cells = rows[rowOffset] ?? [];
    const record: Record<string, unknown> = {};
    for (const field of ["tipo", "documento", "nome"] as const) {
      const index = columnIndex[field];
      if (index != null) {
        record[field] = cells[index];
      }
    }

    const empty = Object.values(record).every(
      (value) => value == null || String(value).trim() === "",
    );
    if (empty) {
      continue;
    }

    const parsed = parseRow(linha, record);
    if (parsed.ok) {
      ok.push(parsed.ok);
    } else if (parsed.erro) {
      erros.push({
        linha,
        motivo: parsed.erro,
        nome: record.nome != null ? cellToText(record.nome) : undefined,
        documento: record.documento != null ? cellToText(record.documento) : undefined,
      });
    }
  }

  return { ok, erros };
}

async function parseWorkbookRows(
  sheet: ExcelJS.Worksheet,
  columnMap?: CadastroColumnMap,
): Promise<ParseCadastroResult> {
  const headerRow = sheet.getRow(1);
  const firstRowCells = rowCells(headerRow.values as unknown[]);
  while (firstRowCells.length > 0 && String(firstRowCells.at(-1) ?? "").trim() === "") {
    firstRowCells.pop();
  }

  const headerless = isHeaderlessCadastroRow(firstRowCells);
  const headers = headerless
    ? syntheticHeaders(firstRowCells.length)
    : firstRowCells.map((value) => (value == null ? "" : String(value).trim()));

  const columnIndex = headerless
    ? inferHeaderlessColumnIndex(firstRowCells)
    : buildColumnIndex(headers, columnMap);

  const columnCount = firstRowCells.length;
  const rows: unknown[][] = [];
  sheet.eachRow((row, rowNumber) => {
    if (headerless) {
      rows.push(readExcelRowCells(row, columnCount));
      return;
    }
    if (rowNumber === 1) {
      return;
    }
    rows.push(readExcelRowCells(row, columnCount));
  });

  return parseRowsFromSheet(headers, rows, columnIndex, headerless ? 1 : 2);
}

function detectCsvDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function extractHeadersFromCsv(buffer: Buffer): string[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Arquivo CSV vazio");
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  return lines[0]!.split(delimiter).map((header) => header.trim());
}

function parseCsvBuffer(
  buffer: Buffer,
  columnMap?: CadastroColumnMap,
): ParseCadastroResult {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Arquivo CSV vazio");
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  const headers = lines[0]!.split(delimiter).map((header) => header.trim());
  const columnIndex = buildColumnIndex(headers, columnMap);
  const rows = lines.slice(1).map((line) => line.split(delimiter));
  return parseRowsFromSheet(headers, rows, columnIndex);
}

async function extractHeadersFromXlsx(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );
  const sheet = workbook.worksheets[0];
  if (sheet == null) {
    return [];
  }

  const headerRow = sheet.getRow(1);
  const headers = rowCells(headerRow.values as unknown[]).map((value) =>
    value == null ? "" : String(value).trim(),
  );
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }
  return headers.filter((header) => header.length > 0);
}

export async function extractSpreadsheetHeaders(
  buffer: Buffer,
  filename: string,
): Promise<SpreadsheetHeadersResult> {
  const suffix = filename.toLowerCase();

  if (suffix.endsWith(".csv")) {
    const headers = extractHeadersFromCsv(buffer);
    const filtered = headers.filter((header) => header.length > 0);
    return {
      headers: filtered,
      suggestedMap: suggestCadastroColumnMap(filtered),
    };
  }

  if (suffix.endsWith(".xlsx") || suffix.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
    );
    const sheet = workbook.worksheets[0];
    if (sheet == null) {
      return { headers: [], suggestedMap: {} };
    }

    const firstRow = rowCells(sheet.getRow(1).values as unknown[]);
    while (firstRow.length > 0 && String(firstRow.at(-1) ?? "").trim() === "") {
      firstRow.pop();
    }

    if (isHeaderlessCadastroRow(firstRow)) {
      const synthetic = syntheticHeaders(firstRow.length);
      return {
        headers: synthetic,
        suggestedMap: {
          nome: "nome",
          documento: "documento",
          tipo: synthetic.length >= 3 ? "tipo" : undefined,
        },
        headerless: true,
      };
    }

    const headers = firstRow
      .map((value) => (value == null ? "" : String(value).trim()))
      .filter((header) => header.length > 0);
    return {
      headers,
      suggestedMap: suggestCadastroColumnMap(headers),
    };
  }

  throw new Error(`Formato não suportado: ${filename}`);
}

export async function parseCadastroSpreadsheet(
  buffer: Buffer,
  filename: string,
  columnMap?: CadastroColumnMap,
): Promise<ParseCadastroResult> {
  const suffix = filename.toLowerCase();
  if (suffix.endsWith(".csv")) {
    return parseCsvBuffer(buffer, columnMap);
  }

  if (suffix.endsWith(".xlsx") || suffix.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
    );
    const sheet = workbook.worksheets[0];
    if (sheet == null) {
      return { ok: [], erros: [] };
    }
    return parseWorkbookRows(sheet, columnMap);
  }

  throw new Error(`Formato não suportado: ${filename}`);
}

export function parseCadastroColumnMap(raw: unknown): CadastroColumnMap | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const documento = String(input.documento ?? "").trim();
  const nome = String(input.nome ?? "").trim();
  const tipoRaw = String(input.tipo ?? "").trim();
  if (!documento || !nome) {
    return null;
  }
  return {
    documento,
    nome,
    ...(tipoRaw ? { tipo: tipoRaw } : {}),
  };
}
