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
const NLM_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_QUERY_TIMEOUT_S = Number(process.env.NLM_QUERY_TIMEOUT ?? 300);

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

export type QueryNotebookOptions = {
  sourceIds?: string[];
  timeoutSeconds?: number;
};

type NlmCliErrorPayload = {
  status?: string;
  error?: string;
};

export function parseNlmCliOutput(output: string): NlmCliErrorPayload | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as NlmCliErrorPayload;
  } catch {
    return null;
  }
}

function nlmExecError(path: string, args: string[], error: { stderr?: string; message: string }): Error {
  return new Error(
    `NotebookLM CLI failed (${path}): nlm ${args.join(" ")}\nStderr: ${error.stderr ?? ""}\nMessage: ${error.message}`,
  );
}

function nlmCliFailureMessage(output: string, fallback: string): string {
  const parsed = parseNlmCliOutput(output);
  if (parsed?.status === "error" && parsed.error) {
    return parsed.error;
  }
  return fallback;
}

async function execNlmAt(path: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(path, args, { maxBuffer: NLM_MAX_BUFFER });
    const failure = nlmCliFailureMessage(stdout, "");
    if (failure) {
      throw new Error(`NotebookLM error: ${failure}`);
    }
    return stdout;
  } catch (error: unknown) {
    const err = error as { code?: string; stderr?: string; message: string; stdout?: string };
    if (err.message.startsWith("NotebookLM error:")) {
      throw error;
    }
    const stdout = err.stdout?.trim() ?? "";
    if (stdout) {
      const failure = nlmCliFailureMessage(stdout, "");
      if (failure) {
        throw new Error(`NotebookLM error: ${failure}`);
      }
    }
    throw nlmExecError(path, args, { stderr: err.stderr, message: err.message });
  }
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
    throw error instanceof Error ? error : nlmExecError(NLM_PATH, finalArgs, err);
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

  await runNlm(["source", "add", notebookId, "--file", filePath, "--wait"]);

  const updatedSources = await listSources(notebookId);
  const newSource = findSourceByFilename(updatedSources, filename);
  if (!newSource?.id) {
    throw new Error(`Source not indexed after upload: ${filename}`);
  }
  return newSource.id;
}

export async function deleteSource(notebookId: string, sourceId: string): Promise<void> {
  await runNlm(["source", "delete", sourceId, "--confirm"]);
}

export function resolveQuerySourceIds(
  sources: NlmSource[],
  pdfFilename: string,
  extraSourceTitles: string[] = ["cadastro_pessoas_db.csv"],
): string[] {
  const pdfSource = findSourceByFilename(sources, pdfFilename);
  if (!pdfSource) {
    throw new Error(`PDF não encontrado no notebook após upload: ${pdfFilename}`);
  }
  const ids = new Set<string>([pdfSource.id]);
  for (const title of extraSourceTitles) {
    const source = findSourceByFilename(sources, title);
    if (source) {
      ids.add(source.id);
    }
  }
  return [...ids];
}

export async function queryNotebook(
  notebookId: string,
  question: string,
  options?: QueryNotebookOptions,
): Promise<NlmQueryResponse> {
  const timeoutSeconds = options?.timeoutSeconds ?? DEFAULT_QUERY_TIMEOUT_S;
  const args = [
    "query",
    "notebook",
    notebookId,
    question,
    "--json",
    "--timeout",
    String(timeoutSeconds),
  ];
  if (options?.sourceIds?.length) {
    args.push("--source-ids", options.sourceIds.join(","));
  }
  const output = await runNlm(args);
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
