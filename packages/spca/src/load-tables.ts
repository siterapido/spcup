import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

const TABELAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "tabelas");

type TableEntry = { descricao?: string };
type Table = Record<string | number, TableEntry>;

const tableCache = new Map<string, Table>();

function normalizeCode(code: string | number): string {
  return String(code).trim();
}

function loadTable(filename: string): Table {
  const cached = tableCache.get(filename);
  if (cached) {
    return cached;
  }

  const path = join(TABELAS_DIR, filename);
  const data = yaml.load(readFileSync(path, "utf-8"));

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Expected mapping in ${filename}`);
  }

  const table = data as Table;
  tableCache.set(filename, table);
  return table;
}

function lookupEntry(table: Table, code: string | number): TableEntry | null {
  const key = normalizeCode(code);
  const entry = table[key];
  if (entry !== undefined) {
    return entry;
  }
  if (/^\d+$/.test(key)) {
    const numeric = table[Number(key)];
    if (numeric !== undefined) {
      return numeric;
    }
  }
  return null;
}

function formatLabel(code: string | number, filename: string): string {
  const key = normalizeCode(code);
  const entry = lookupEntry(loadTable(filename), code);
  if (entry === null) {
    return key;
  }
  const descricao = entry.descricao ?? "";
  if (descricao) {
    return `${key} - ${descricao}`;
  }
  return key;
}

/** Return human-readable label for a classificacao_receita code. */
export function getClassificacaoLabel(code: string | number): string {
  return formatLabel(code, "classificacao_receita.yaml");
}

/** Return human-readable label for a cdDescricaoGasto code. */
export function getGastoLabel(code: string | number): string {
  return formatLabel(code, "codigos_gasto.yaml");
}
