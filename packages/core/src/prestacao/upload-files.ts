import { randomUUID } from "node:crypto";
import path from "node:path";

import { sessaoPrestacao, SESSAO_STATUS, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { classifyIngestError } from "../ingest/errors";
import { ingestLog } from "../ingest/log";
import { ingestFileBuffer } from "../ingest/pipeline";
import { armazenarPdfIngestBuffer } from "../ingest/pdf-pagina";
import type { PrestadorContext } from "../ingest/types";

const ALLOWED = new Set([".ofx", ".xlsx", ".xls", ".pdf"]);

export type PersistStorageFn = (
  relativePath: string,
  buffer: Buffer,
) => Promise<string>;

export type UploadFileInput = { filename: string; buffer: Buffer };

export type UploadErroItem = {
  nome: string;
  codigo: string;
  mensagem: string;
  causaTecnica: string;
};

export type UploadArquivoResult = {
  nome: string;
  movimentacoes_criadas: number;
  arquivo_id?: string;
  paginas?: number;
  modo?: "armazenar";
  linhas_ignoradas_sem_doc?: number;
};

export type UploadFilesResult = {
  arquivos: UploadArquivoResult[];
  erros: UploadErroItem[];
  total_movimentacoes: number;
};

export async function uploadFilesToSessao(
  db: Db,
  params: {
    sessaoId: string;
    diretorioEstadualId: string;
    uf: string;
    exercicio: number;
    prestador: PrestadorContext;
    files: UploadFileInput[];
    persistStorage: PersistStorageFn;
  },
): Promise<UploadFilesResult> {
  const { sessaoId, files, persistStorage, prestador } = params;
  const results: UploadArquivoResult[] = [];
  const errors: UploadErroItem[] = [];

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.EM_PROCESSAMENTO })
    .where(eq(sessaoPrestacao.id, sessaoId));

  for (const file of files) {
    const suffix = path.extname(file.filename).toLowerCase();
    if (!ALLOWED.has(suffix)) {
      errors.push({
        nome: file.filename,
        codigo: "INGESTAO_DESCONHECIDA",
        mensagem: "Formato não suportado. Use PDF, Excel ou OFX.",
        causaTecnica: `Extensão não permitida: ${suffix || "(sem extensão)"}`,
      });
      continue;
    }

    const blobPath = `${params.uf}/${params.exercicio}/${sessaoId}/${randomUUID()}/${file.filename}`;
    let caminhoStorage: string;
    try {
      caminhoStorage = await persistStorage(blobPath, file.buffer);
    } catch (error) {
      const detail = classifyIngestError(
        error instanceof Error ? error : new Error("falha no storage"),
      );
      ingestLog("error", {
        fase: "storage",
        sessaoId,
        filename: file.filename,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.filename,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
        causaTecnica: detail.causaTecnica,
      });
      continue;
    }

    const prestadorCtx = {
      ...prestador,
      sessaoPrestacaoId: sessaoId,
    };

    try {
      if (suffix === ".pdf") {
        const stored = await armazenarPdfIngestBuffer(db, {
          diretorioId: params.diretorioEstadualId,
          uf: params.uf,
          exercicio: params.exercicio,
          filename: file.filename,
          buffer: file.buffer,
          caminhoStorage,
          sessaoPrestacaoId: sessaoId,
          prestador: prestadorCtx,
        });
        results.push({
          nome: file.filename,
          movimentacoes_criadas: 0,
          arquivo_id: stored.arquivoId,
          paginas: stored.pageCount,
          modo: "armazenar",
        });
        continue;
      }

      const result = await ingestFileBuffer(db, {
        diretorioId: params.diretorioEstadualId,
        uf: params.uf,
        exercicio: params.exercicio,
        filename: file.filename,
        buffer: file.buffer,
        caminhoStorage,
        sessaoPrestacaoId: sessaoId,
        prestador: prestadorCtx,
      });
      results.push({
        nome: file.filename,
        movimentacoes_criadas: result.movimentacoes_criadas,
        ...(result.linhas_ignoradas_sem_doc != null && result.linhas_ignoradas_sem_doc > 0
          ? { linhas_ignoradas_sem_doc: result.linhas_ignoradas_sem_doc }
          : {}),
      });
    } catch (error) {
      const detail = classifyIngestError(error);
      ingestLog("error", {
        fase: "persist",
        sessaoId,
        filename: file.filename,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.filename,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
        causaTecnica: detail.causaTecnica,
      });
    }
  }

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.ABERTA, updatedAt: new Date() })
    .where(eq(sessaoPrestacao.id, sessaoId));

  const total_movimentacoes = results.reduce((s, r) => s + r.movimentacoes_criadas, 0);
  return { arquivos: results, erros: errors, total_movimentacoes };
}
