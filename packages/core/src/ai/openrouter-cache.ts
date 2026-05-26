import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fileHashBuffer } from "../ingest/hash";

export interface CachedExtratoExtraction {
  transacoes: Array<Record<string, unknown>>;
}

function cacheEnabled(): boolean {
  return process.env.OPENROUTER_CACHE !== "0";
}

function cacheDir(): string {
  const root = process.env.STORAGE_ROOT ?? "./data/uploads";
  return process.env.OPENROUTER_CACHE_DIR ?? path.join(root, ".openrouter-cache");
}

function modelCacheSlug(model: string): string {
  return model.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
}

async function readCacheFile(filePath: string): Promise<CachedExtratoExtraction | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { transacoes?: unknown };
    if (!Array.isArray(parsed.transacoes)) {
      return null;
    }
    return {
      transacoes: parsed.transacoes.map((item) =>
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {},
      ),
    };
  } catch {
    return null;
  }
}

async function writeCacheFile(
  filePath: string,
  extraction: CachedExtratoExtraction,
): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(extraction), "utf8");
}

/** Disk cache for PDF extrato (key = model + SHA-256 of file bytes). */
export async function readExtratoPdfCache(
  buffer: Buffer,
  model: string,
): Promise<CachedExtratoExtraction | null> {
  if (!cacheEnabled()) {
    return null;
  }
  const key = `${modelCacheSlug(model)}_${fileHashBuffer(buffer)}`;
  return readCacheFile(path.join(cacheDir(), `${key}.json`));
}

export async function writeExtratoPdfCache(
  buffer: Buffer,
  model: string,
  extraction: CachedExtratoExtraction,
): Promise<void> {
  if (!cacheEnabled()) {
    return;
  }
  const key = `${modelCacheSlug(model)}_${fileHashBuffer(buffer)}`;
  await writeCacheFile(path.join(cacheDir(), `${key}.json`), extraction);
}

/** Disk cache for text extrato (key = model + SHA-256 of normalized statement text). */
export async function readExtratoTextCache(
  statementText: string,
  model: string,
): Promise<CachedExtratoExtraction | null> {
  if (!cacheEnabled()) {
    return null;
  }
  const textKey = createHash("sha256").update(statementText.trim(), "utf8").digest("hex");
  const key = `${modelCacheSlug(model)}_text_${textKey}`;
  return readCacheFile(path.join(cacheDir(), `${key}.json`));
}

export async function writeExtratoTextCache(
  statementText: string,
  model: string,
  extraction: CachedExtratoExtraction,
): Promise<void> {
  if (!cacheEnabled()) {
    return;
  }
  const textKey = createHash("sha256").update(statementText.trim(), "utf8").digest("hex");
  const key = `${modelCacheSlug(model)}_text_${textKey}`;
  await writeCacheFile(path.join(cacheDir(), `${key}.json`), extraction);
}
