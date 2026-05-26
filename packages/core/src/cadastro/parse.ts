import ExcelJS from "exceljs";

import { normalizeCnpj, normalizeCpf, normalizeName } from "../normalize";
import { parseCadastroTipo } from "./constants";
import type {
  CadastroColumnMap,
  CadastroRow,
  ParseCadastroResult,
  SpreadsheetHeadersResult,
} from "./types";

type CadastroField = "tipo" | "documento" | "nome";

const REQUIRED_FIELDS: CadastroField[] = ["documento", "nome"];

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
  nr_documento: "documento",
  numero_documento: "documento",
  nome: "nome",
  name: "nome",
  razao_social: "nome",
  razao: "nome",
  nome_completo: "nome",
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
  const digits = documentoRaw.replace(/\D/g, "");
  if (digits.length === 11) {
    return "PF";
  }
  if (digits.length === 14) {
    return "PJ";
  }
  return null;
}

function normalizeDocumento(tipo: "PF" | "PJ", raw: string): string {
  return tipo === "PF" ? normalizeCpf(raw) : normalizeCnpj(raw);
}

function parseRow(
  linha: number,
  record: Record<string, unknown>,
): { ok?: CadastroRow; erro?: string } {
  const tipoRaw = String(record.tipo ?? "").trim();
  let tipo = tipoRaw ? parseCadastroTipo(tipoRaw) : null;

  if (tipoRaw && tipo == null) {
    return { erro: `Tipo inválido: ${tipoRaw}` };
  }

  const documentoRaw = String(record.documento ?? "").trim();
  const nomeRaw = String(record.nome ?? "").trim();
  if (!documentoRaw) {
    return { erro: "Documento vazio" };
  }
  if (!nomeRaw) {
    return { erro: "Nome vazio" };
  }

  if (tipo == null) {
    tipo = inferTipoFromDocumento(documentoRaw);
  }
  if (tipo == null) {
    return { erro: `Tipo inválido: ${tipoRaw || "(vazio)"}` };
  }

  try {
    const documento = normalizeDocumento(tipo, documentoRaw);
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

function parseRowsFromSheet(
  headers: string[],
  rows: unknown[][],
  columnIndex: Record<CadastroField, number | undefined>,
): ParseCadastroResult {
  const ok: CadastroRow[] = [];
  const erros: ParseCadastroResult["erros"] = [];

  for (let rowOffset = 0; rowOffset < rows.length; rowOffset += 1) {
    const linha = rowOffset + 2;
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
      erros.push({ linha, motivo: parsed.erro });
    }
  }

  return { ok, erros };
}

async function parseWorkbookRows(
  sheet: ExcelJS.Worksheet,
  columnMap?: CadastroColumnMap,
): Promise<ParseCadastroResult> {
  const headerRow = sheet.getRow(1);
  const headerValues = headerRow.values as unknown[];
  const headers = rowCells(headerValues).map((value) =>
    value == null ? "" : String(value).trim(),
  );
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }

  const columnIndex = buildColumnIndex(headers, columnMap);
  const rows: unknown[][] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    rows.push(rowCells(row.values as unknown[]));
  });

  return parseRowsFromSheet(headers, rows, columnIndex);
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
  let headers: string[];

  if (suffix.endsWith(".csv")) {
    headers = extractHeadersFromCsv(buffer);
  } else if (suffix.endsWith(".xlsx") || suffix.endsWith(".xls")) {
    headers = await extractHeadersFromXlsx(buffer);
  } else {
    throw new Error(`Formato não suportado: ${filename}`);
  }

  const filtered = headers.filter((header) => header.length > 0);
  return {
    headers: filtered,
    suggestedMap: suggestCadastroColumnMap(filtered),
  };
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
