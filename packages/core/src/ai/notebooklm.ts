import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseCadastroSpreadsheet } from "../cadastro/parse";

const execFileAsync = promisify(execFile);

const DEFAULT_NLM_PATH = "nlm";
const NLM_FALLBACK_PATH = `${process.env.HOME ?? ""}/.local/bin/nlm`;
const NLM_PATH = process.env.NLM_PATH || DEFAULT_NLM_PATH;

const UPLOADABLE_RULE_SUFFIXES = new Set([".pdf", ".txt"]);
const UPLOADABLE_CADASTRO_SUFFIXES = new Set([".csv", ".pdf", ".txt"]);
const SPREADSHEET_SUFFIXES = new Set([".xlsx", ".xls"]);

export interface NlmNotebook {
  id: string;
  title: string;
}

export interface NlmSource {
  id: string;
  title: string;
}

export interface NlmQueryResponse {
  answer: string;
  [key: string]: unknown;
}

function nlmExecError(path: string, args: string[], error: { stderr?: string; message: string }): Error {
  return new Error(
    `NotebookLM CLI failed (${path}): nlm ${args.join(" ")}\nStderr: ${error.stderr ?? ""}\nMessage: ${error.message}`,
  );
}

async function execNlmAt(path: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(path, args);
  return stdout;
}

async function runNlm(args: string[]): Promise<string> {
  const profile = process.env.NOTEBOOKLM_PROFILE;
  const finalArgs = profile ? [...args, "--profile", profile] : [...args];

  try {
    return await execNlmAt(NLM_PATH, finalArgs);
  } catch (error: unknown) {
    const err = error as { code?: string; stderr?: string; message: string };
    if (err.code === "ENOENT" && NLM_PATH === DEFAULT_NLM_PATH && process.env.HOME) {
      try {
        return await execNlmAt(NLM_FALLBACK_PATH, finalArgs);
      } catch (fallbackError: unknown) {
        const fb = fallbackError as { stderr?: string; message: string };
        throw nlmExecError(NLM_FALLBACK_PATH, finalArgs, fb);
      }
    }
    throw nlmExecError(NLM_PATH, finalArgs, err);
  }
}

function parseJsonOutput<T>(output: string, label: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`Failed to parse ${label} JSON: ${output}`);
  }
}

function findSourceByFilename(sources: NlmSource[], filename: string): NlmSource | undefined {
  const normalized = filename.trim().toLowerCase();
  return sources.find((s) => s.title.trim().toLowerCase() === normalized);
}

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function isExistingDirectory(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function listNotebooks(): Promise<NlmNotebook[]> {
  const output = await runNlm(["notebook", "list", "--json"]);
  return parseJsonOutput<NlmNotebook[]>(output, "notebooks list");
}

export async function createNotebook(title: string): Promise<string> {
  const output = await runNlm(["notebook", "create", title, "--json"]);
  try {
    const parsed = parseJsonOutput<{
      notebook_id?: string;
      id?: string;
      notebook?: { id?: string };
    }>(output, "create notebook");
    if (parsed.notebook_id) return parsed.notebook_id;
    if (parsed.id) return parsed.id;
    if (parsed.notebook?.id) return parsed.notebook.id;
    throw new Error("Notebook ID missing in create response");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse create notebook response: ${output}. Error: ${message}`);
  }
}

export async function getOrCreateNotebook(uf: string, exercicio: number): Promise<string> {
  const title = `SPC-UP ${uf.toUpperCase()} ${exercicio}`;
  const notebooks = await listNotebooks();
  const existing = notebooks.find((n) => n.title.trim().toLowerCase() === title.toLowerCase());
  if (existing) {
    return existing.id;
  }
  return createNotebook(title);
}

export async function listSources(notebookId: string): Promise<NlmSource[]> {
  const output = await runNlm(["source", "list", notebookId, "--json"]);
  return parseJsonOutput<NlmSource[]>(output, "sources list");
}

export async function uploadFileToNotebook(notebookId: string, filePath: string): Promise<string> {
  const filename = path.basename(filePath);
  const sources = await listSources(notebookId);
  const existing = findSourceByFilename(sources, filename);
  if (existing) {
    return existing.id;
  }

  const output = await runNlm(["source", "add", notebookId, "--file", filePath, "--wait"]);

  const updatedSources = await listSources(notebookId);
  const newSource = findSourceByFilename(updatedSources, filename);
  return newSource?.id ?? output;
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<void> {
  await runNlm(["source", "delete", sourceId, "--confirm"]);
}

export async function queryNotebook(notebookId: string, question: string): Promise<NlmQueryResponse> {
  const output = await runNlm(["query", "notebook", notebookId, question, "--json"]);
  try {
    return parseJsonOutput<NlmQueryResponse>(output, "query response");
  } catch {
    return { answer: output };
  }
}

async function uploadSpreadsheetAsCsv(notebookId: string, fullPath: string, entry: string): Promise<void> {
  const suffix = path.extname(entry).toLowerCase();
  try {
    const buffer = await fs.readFile(fullPath);
    const parsed = await parseCadastroSpreadsheet(buffer, entry);
    if (parsed.ok.length === 0) {
      return;
    }

    const header = "tipo,documento,nome\n";
    const rowsText = parsed.ok
      .map((row) => `${row.tipo},${row.documento},${escapeCsvField(row.nome)}`)
      .join("\n");

    const csvName = `${path.basename(entry, suffix)}_converted.csv`;
    const tmpCsvPath = path.join(os.tmpdir(), csvName);
    await fs.writeFile(tmpCsvPath, header + rowsText, "utf8");
    try {
      await uploadFileToNotebook(notebookId, tmpCsvPath);
    } finally {
      await fs.unlink(tmpCsvPath).catch(() => {});
    }
  } catch {
    await uploadFileToNotebook(notebookId, fullPath);
  }
}

export async function syncCandidateFolder(notebookId: string, uf: string, exercicio: number): Promise<void> {
  const baseDir = process.env.CADASTRO_ROOT || path.join(process.cwd(), "data", "cadastros");
  const dirPath = path.join(baseDir, uf.toUpperCase(), String(exercicio));

  if (!(await isExistingDirectory(dirPath))) {
    return;
  }

  const entries = await fs.readdir(dirPath);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const fileStats = await fs.stat(fullPath);
    if (!fileStats.isFile()) {
      continue;
    }

    const suffix = path.extname(entry).toLowerCase();
    if (SPREADSHEET_SUFFIXES.has(suffix)) {
      await uploadSpreadsheetAsCsv(notebookId, fullPath, entry);
    } else if (UPLOADABLE_CADASTRO_SUFFIXES.has(suffix)) {
      await uploadFileToNotebook(notebookId, fullPath);
    }
  }
}

async function uploadRulesFromDirectory(notebookId: string, dirPath: string): Promise<boolean> {
  const entries = await fs.readdir(dirPath);
  let uploadedAny = false;

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    const fileStats = await fs.stat(fullPath);
    if (!fileStats.isFile()) {
      continue;
    }
    const suffix = path.extname(entry).toLowerCase();
    if (UPLOADABLE_RULE_SUFFIXES.has(suffix)) {
      await uploadFileToNotebook(notebookId, fullPath);
      uploadedAny = true;
    }
  }

  return uploadedAny;
}

export async function syncRulesFolder(notebookId: string): Promise<void> {
  const candidateDirs = [
    process.env.REGRAS_ROOT,
    path.join(process.cwd(), "data", "regras"),
    path.join(process.cwd(), "Guia importação SPCA"),
  ].filter((p): p is string => Boolean(p));

  for (const dirPath of candidateDirs) {
    if (!(await isExistingDirectory(dirPath))) {
      continue;
    }
    if (await uploadRulesFromDirectory(notebookId, dirPath)) {
      break;
    }
  }
}
