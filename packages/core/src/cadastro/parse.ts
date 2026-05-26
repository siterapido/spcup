import ExcelJS from "exceljs";

import { normalizeCnpj, normalizeCpf, normalizeName } from "../normalize";
import { parseCadastroTipo } from "./constants";
import type { CadastroRow, ParseCadastroResult } from "./types";

const REQUIRED_COLUMNS = new Set(["tipo", "documento", "nome"]);

function normalizeHeader(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const key = String(value).trim().toLowerCase();
  return REQUIRED_COLUMNS.has(key) ? key : null;
}

function normalizeDocumento(tipo: "PF" | "PJ", raw: string): string {
  return tipo === "PF" ? normalizeCpf(raw) : normalizeCnpj(raw);
}

function parseRow(
  linha: number,
  record: Record<string, unknown>,
): { ok?: CadastroRow; erro?: string } {
  const tipoRaw = String(record.tipo ?? "").trim();
  const tipo = parseCadastroTipo(tipoRaw);
  if (tipo == null) {
    return { erro: `Tipo inválido: ${tipoRaw || "(vazio)"}` };
  }

  const documentoRaw = String(record.documento ?? "").trim();
  const nomeRaw = String(record.nome ?? "").trim();
  if (!documentoRaw) {
    return { erro: "Documento vazio" };
  }
  if (!nomeRaw) {
    return { erro: "Nome vazio" };
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

async function parseWorkbookRows(
  sheet: ExcelJS.Worksheet,
): Promise<ParseCadastroResult> {
  const columnIndex: Record<string, number> = {};
  const ok: CadastroRow[] = [];
  const erros: ParseCadastroResult["erros"] = [];
  let headerReady = false;
  let linha = 0;

  sheet.eachRow((row) => {
    linha += 1;
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
        throw new Error(
          `Colunas obrigatórias ausentes: ${missing.sort().join(", ")}`,
        );
      }
      headerReady = true;
      return;
    }

    const record: Record<string, unknown> = {};
    for (const [name, index] of Object.entries(columnIndex)) {
      record[name] = cells[index];
    }
    const empty = Object.values(record).every(
      (value) => value == null || String(value).trim() === "",
    );
    if (empty) {
      return;
    }

    const parsed = parseRow(linha, record);
    if (parsed.ok) {
      ok.push(parsed.ok);
    } else if (parsed.erro) {
      erros.push({ linha, motivo: parsed.erro });
    }
  });

  return { ok, erros };
}

function detectCsvDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons > commas ? ";" : ",";
}

function parseCsvBuffer(buffer: Buffer): ParseCadastroResult {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("Arquivo CSV vazio");
  }

  const delimiter = detectCsvDelimiter(lines[0]!);
  const headerCells = lines[0]!.split(delimiter);
  const columnIndex: Record<string, number> = {};
  for (let index = 0; index < headerCells.length; index += 1) {
    const name = normalizeHeader(headerCells[index]);
    if (name != null) {
      columnIndex[name] = index;
    }
  }
  const missing = [...REQUIRED_COLUMNS].filter((col) => !(col in columnIndex));
  if (missing.length > 0) {
    throw new Error(`Colunas obrigatórias ausentes: ${missing.sort().join(", ")}`);
  }

  const ok: CadastroRow[] = [];
  const erros: ParseCadastroResult["erros"] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const linha = i + 1;
    const cells = lines[i]!.split(delimiter);
    const record: Record<string, unknown> = {};
    for (const [name, index] of Object.entries(columnIndex)) {
      record[name] = cells[index];
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

export async function parseCadastroSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<ParseCadastroResult> {
  const suffix = filename.toLowerCase();
  if (suffix.endsWith(".csv")) {
    return parseCsvBuffer(buffer);
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
    return parseWorkbookRows(sheet);
  }

  throw new Error(`Formato não suportado: ${filename}`);
}
