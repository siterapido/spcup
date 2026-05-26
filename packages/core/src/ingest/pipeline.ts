import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  arquivoIngestao,
  diretorioEstadual,
  type Db,
  type DiretorioEstadual,
} from "@spc-up/db";
import { eq } from "drizzle-orm";

import { storageRoot as resolveStorageRoot } from "../export/common";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { parseExcel } from "./excel";
import { fileHashBuffer } from "./hash";
import { ingestPdf } from "./pdf";
import { parseOfx, persistTransactions } from "./ofx";
import {
  ARQUIVO_INGESTAO_STATUS,
  TIPO_PRESTADOR,
  type IngestRow,
  type PrestadorContext,
} from "./types";

export const INGEST_EXTENSIONS = new Set([".ofx", ".xlsx", ".xls", ".pdf"]);

export { fileHash, fileHashBuffer } from "./hash";

export async function storeUpload(
  sourcePath: string,
  uf: string,
  exercicio: number,
  storageRoot: string,
): Promise<string> {
  const destDir = path.join(storageRoot, uf.toUpperCase(), String(exercicio));
  await mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(sourcePath));
  await copyFile(sourcePath, dest);
  return dest;
}

export async function parseIngestFile(filePath: string): Promise<IngestRow[]> {
  const suffix = path.extname(filePath).toLowerCase();
  if (suffix === ".ofx") {
    return parseOfx(filePath);
  }
  if (suffix === ".xlsx" || suffix === ".xls") {
    return parseExcel(filePath);
  }
  throw new Error(`Formato não suportado: ${suffix}`);
}

export async function getDiretorio(
  db: Db,
  uf: string,
): Promise<DiretorioEstadual | undefined> {
  return db.query.diretorioEstadual.findFirst({
    where: eq(diretorioEstadual.uf, uf.toUpperCase()),
  });
}

export async function resolveIngestPaths(input: string): Promise<string[]> {
  const resolved = path.resolve(input);
  const info = await stat(resolved);
  if (info.isFile()) {
    return [resolved];
  }
  if (!info.isDirectory()) {
    throw new Error(`Caminho inválido: ${input}`);
  }

  const entries = await readdir(resolved);
  const files: string[] = [];
  for (const name of entries) {
    const full = path.join(resolved, name);
    const entryStat = await stat(full);
    if (!entryStat.isFile()) {
      continue;
    }
    if (INGEST_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      files.push(full);
    }
  }

  if (files.length === 0) {
    throw new Error(
      `Nenhum arquivo OFX/Excel/PDF em ${input} (extensões: ${[...INGEST_EXTENSIONS].join(", ")})`,
    );
  }

  return files.sort();
}

export interface IngestFileParams {
  diretorioId: string;
  uf: string;
  exercicio: number;
  source: string;
  storageRoot?: string;
  confiancaLimiteAlta?: number;
  prestador?: PrestadorContext;
  sessaoPrestacaoId?: string;
}

function defaultStorageRoot(): string {
  return resolveStorageRoot();
}

/** Parse file, persist movimentações, run deterministic match. Returns created count. */
export async function ingestFile(
  db: Db,
  params: IngestFileParams,
): Promise<number> {
  const storageRoot = params.storageRoot ?? defaultStorageRoot();
  const uf = params.uf.toUpperCase();
  const source = path.resolve(params.source);
  const buffer = await readFile(source);
  const stored = await storeUpload(source, uf, params.exercicio, storageRoot);

  const prestador = await resolvePrestadorForIngest(db, uf, params);

  const [arquivo] = await db
    .insert(arquivoIngestao)
    .values({
      diretorioEstadualId: params.diretorioId,
      sessaoPrestacaoId: prestador.sessaoPrestacaoId,
      uf,
      exercicio: params.exercicio,
      nomeArquivo: path.basename(source),
      hashArquivo: fileHashBuffer(buffer),
      caminhoStorage: stored,
      status: ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
    })
    .returning();

  if (!arquivo) {
    throw new Error("Failed to create arquivo_ingestao");
  }

  try {
    const suffix = path.extname(source).toLowerCase();
    let createdCount: number;

    if (suffix === ".pdf") {
      const matched = await ingestPdf(
        db,
        uf,
        params.exercicio,
        arquivo.id,
        buffer,
        prestador,
      );
      createdCount = matched.length;
    } else {
      const rows = await parseIngestFile(source);
      const created = await persistTransactions(
        db,
        uf,
        params.exercicio,
        arquivo.id,
        rows,
        prestador,
      );

      for (const mov of created) {
        await applyAiMatchToMovimentacao(db, mov.id);
      }
      createdCount = created.length;
    }

    await db
      .update(arquivoIngestao)
      .set({ status: ARQUIVO_INGESTAO_STATUS.CONCLUIDO })
      .where(eq(arquivoIngestao.id, arquivo.id));

    return createdCount;
  } catch (error) {
    await db
      .update(arquivoIngestao)
      .set({
        status: ARQUIVO_INGESTAO_STATUS.ERRO,
        erroMensagem: error instanceof Error ? error.message : String(error),
      })
      .where(eq(arquivoIngestao.id, arquivo.id));
    throw error;
  }
}

export interface IngestBufferParams {
  diretorioId: string;
  uf: string;
  exercicio: number;
  filename: string;
  buffer: Buffer;
  caminhoStorage: string;
  confiancaLimiteAlta?: number;
  prestador?: PrestadorContext;
  sessaoPrestacaoId?: string;
}

async function resolvePrestadorForIngest(
  db: Db,
  uf: string,
  params: { prestador?: PrestadorContext; sessaoPrestacaoId?: string },
): Promise<PrestadorContext> {
  if (params.prestador) {
    return {
      ...params.prestador,
      sessaoPrestacaoId: params.prestador.sessaoPrestacaoId ?? params.sessaoPrestacaoId,
    };
  }
  const diretorio = await getDiretorio(db, uf);
  if (!diretorio) {
    throw new Error(`Diretório estadual não cadastrado para UF=${uf}`);
  }
  return {
    cnpjPrestador: diretorio.cnpjPrestador,
    tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
    sessaoPrestacaoId: params.sessaoPrestacaoId,
  };
}

async function parseIngestBuffer(
  buffer: Buffer,
  filename: string,
): Promise<IngestRow[]> {
  const suffix = path.extname(filename).toLowerCase();
  if (suffix === ".ofx") {
    return parseOfx(buffer);
  }
  if (suffix === ".xlsx" || suffix === ".xls") {
    return parseExcel(buffer);
  }
  throw new Error(`Formato não suportado: ${suffix}`);
}

/** Ingest from in-memory buffer (web upload + Vercel Blob URL). */
export async function ingestFileBuffer(
  db: Db,
  params: IngestBufferParams,
): Promise<{ movimentacoes_criadas: number; ids: string[] }> {
  const uf = params.uf.toUpperCase();
  const suffix = path.extname(params.filename).toLowerCase();
  if (!INGEST_EXTENSIONS.has(suffix)) {
    throw new Error(
      `Formato não suportado. Use: ${[...INGEST_EXTENSIONS].join(", ")}`,
    );
  }

  const prestador = await resolvePrestadorForIngest(db, uf, params);

  const [arquivo] = await db
    .insert(arquivoIngestao)
    .values({
      diretorioEstadualId: params.diretorioId,
      sessaoPrestacaoId: prestador.sessaoPrestacaoId,
      uf,
      exercicio: params.exercicio,
      nomeArquivo: params.filename,
      hashArquivo: fileHashBuffer(params.buffer),
      caminhoStorage: params.caminhoStorage,
      status: ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
    })
    .returning();

  if (!arquivo) {
    throw new Error("Failed to create arquivo_ingestao");
  }

  try {
    let matchedIds: string[];

    if (suffix === ".pdf") {
      const matched = await ingestPdf(
        db,
        uf,
        params.exercicio,
        arquivo.id,
        params.buffer,
        prestador,
      );
      matchedIds = matched.map((m) => m.id);
    } else {
      const rows = await parseIngestBuffer(params.buffer, params.filename);
      const created = await persistTransactions(
        db,
        uf,
        params.exercicio,
        arquivo.id,
        rows,
        prestador,
      );

      for (const mov of created) {
        await applyAiMatchToMovimentacao(db, mov.id);
      }
      matchedIds = created.map((m) => m.id);
    }

    await db
      .update(arquivoIngestao)
      .set({ status: ARQUIVO_INGESTAO_STATUS.CONCLUIDO })
      .where(eq(arquivoIngestao.id, arquivo.id));

    return {
      movimentacoes_criadas: matchedIds.length,
      ids: matchedIds,
    };
  } catch (error) {
    await db
      .update(arquivoIngestao)
      .set({
        status: ARQUIVO_INGESTAO_STATUS.ERRO,
        erroMensagem: error instanceof Error ? error.message : String(error),
      })
      .where(eq(arquivoIngestao.id, arquivo.id));
    throw error;
  }
}

/** Ingest all supported files under a path (file or directory). */
export async function ingestPath(
  db: Db,
  params: IngestFileParams & { path: string },
): Promise<number> {
  const sources = await resolveIngestPaths(params.path);
  let total = 0;
  for (const source of sources) {
    total += await ingestFile(db, { ...params, source });
  }
  return total;
}
