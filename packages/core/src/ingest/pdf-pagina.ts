import type { Db } from "@spc-up/db";
import { arquivoIngestao, movimentacao } from "@spc-up/db";
import { count, eq } from "drizzle-orm";

import {
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  type ExtractStructuredOptions,
} from "../ai/openrouter";
import { applyDeterministicMatch } from "../match/rules";
import { readArquivoIngestaoBuffer } from "../storage/read-arquivo";
import { IngestError, toIngestError } from "./errors";
import { fileHashBuffer } from "./hash";
import { ingestLog } from "./log";
import { persistTransactions } from "./ofx";
import { rowsFromExtratoTransactions } from "./pdf";
import { extractPdfText } from "./pdf-text";
import { extractSinglePageBuffer, getPdfPageCount } from "./pdf-split";
import type { IngestBufferParams } from "./pipeline";
import type { ParsedTransactionRow, PrestadorContext } from "./types";
import { ARQUIVO_INGESTAO_STATUS } from "./types";

export type ArmazenarPdfResult = {
  arquivoId: string;
  pageCount: number;
  nome: string;
};

export type ProcessarPaginaPdfResult = {
  pagina: number;
  totalPaginas: number;
  movimentacoes_criadas: number;
  linhas_ignoradas_sem_doc?: number;
};

/** Store PDF in Blob/storage and create arquivo_ingestao (PENDENTE) without extraction. */
export async function armazenarPdfIngestBuffer(
  db: Db,
  params: IngestBufferParams,
): Promise<ArmazenarPdfResult> {
  const suffix = params.filename.slice(params.filename.lastIndexOf(".")).toLowerCase();
  if (suffix !== ".pdf") {
    throw new Error("armazenarPdfIngestBuffer aceita apenas PDF");
  }

  const uf = params.uf.toUpperCase();
  const pageCount = await getPdfPageCount(params.buffer);

  const [arquivo] = await db
    .insert(arquivoIngestao)
    .values({
      diretorioEstadualId: params.diretorioId,
      sessaoPrestacaoId: params.prestador?.sessaoPrestacaoId ?? params.sessaoPrestacaoId,
      uf,
      exercicio: params.exercicio,
      nomeArquivo: params.filename,
      hashArquivo: fileHashBuffer(params.buffer),
      caminhoStorage: params.caminhoStorage,
      status: ARQUIVO_INGESTAO_STATUS.PENDENTE,
    })
    .returning();

  if (!arquivo) {
    throw new Error("Failed to create arquivo_ingestao");
  }

  ingestLog("info", {
    fase: "storage",
    arquivoId: arquivo.id,
    filename: params.filename,
    paginas: pageCount,
  });

  return {
    arquivoId: arquivo.id,
    pageCount,
    nome: params.filename,
  };
}

async function extractRowsFromPageBuffer(
  pageBuffer: Buffer,
  filename: string,
  arquivoId: string,
  page1Based: number,
  pageCount: number,
  options?: ExtractStructuredOptions,
): Promise<{ rows: ParsedTransactionRow[]; linhasIgnoradasSemDoc: number }> {
  const { text, hasEnoughText } = await extractPdfText(pageBuffer);

  const extraction = hasEnoughText
    ? await extractTransactionsFromPdfText(text, { ...options, filename })
    : await extractTransactionsFromPdfFile(pageBuffer, { ...options, filename });

  if (!hasEnoughText && extraction.transacoes.length === 0) {
    throw new Error(
      "Não foi possível extrair transações desta página (scan ou formato não suportado).",
    );
  }

  for (const item of extraction.transacoes) {
    item.__batch_pagina = page1Based;
  }

  const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(extraction, {
    attachOrigem: !hasEnoughText,
    arquivoIngestaoId: arquivoId,
    nomeArquivo: filename,
    pageCount,
  });

  return { rows, linhasIgnoradasSemDoc };
}

/** Extract and persist one 1-based page of a stored extrato PDF. */
export async function processarPaginaPdfExtrato(
  db: Db,
  arquivoId: string,
  pagina: number,
  prestador: PrestadorContext,
  options?: ExtractStructuredOptions,
): Promise<ProcessarPaginaPdfResult> {
  if (!Number.isInteger(pagina) || pagina < 1) {
    throw new Error(`Página inválida: ${pagina}`);
  }

  const rows = await db
    .select()
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.id, arquivoId))
    .limit(1);
  const arquivo = rows[0];
  if (!arquivo) {
    throw new Error(`Arquivo de ingestão não encontrado: ${arquivoId}`);
  }

  if (
    arquivo.status !== ARQUIVO_INGESTAO_STATUS.PENDENTE &&
    arquivo.status !== ARQUIVO_INGESTAO_STATUS.PROCESSANDO
  ) {
    throw new Error(
      `Arquivo não está pendente de processamento (status=${arquivo.status})`,
    );
  }

  const t0 = Date.now();
  const filename = arquivo.nomeArquivo;
  ingestLog("info", { fase: "inicio", arquivoId, filename, pagina });

  try {
    const buffer = await readArquivoIngestaoBuffer(arquivo.caminhoStorage);
    const totalPaginas = await getPdfPageCount(buffer);
    if (pagina > totalPaginas) {
      throw new Error(`Página ${pagina} inexistente (total ${totalPaginas})`);
    }

    if (pagina === 1) {
      await db
        .update(arquivoIngestao)
        .set({ status: ARQUIVO_INGESTAO_STATUS.PROCESSANDO, updatedAt: new Date() })
        .where(eq(arquivoIngestao.id, arquivoId));
    }

    const pageBuffer = await extractSinglePageBuffer(buffer, pagina);
    const { rows: parsedRows, linhasIgnoradasSemDoc } = await extractRowsFromPageBuffer(
      pageBuffer,
      filename,
      arquivoId,
      pagina,
      totalPaginas,
      { ...options, filename },
    );

    let movimentacoes_criadas = 0;
    if (parsedRows.length > 0) {
      const created = await persistTransactions(
        db,
        arquivo.uf,
        arquivo.exercicio,
        arquivoId,
        parsedRows,
        prestador,
      );
      for (const mov of created) {
        await applyDeterministicMatch(db, mov.id);
      }
      movimentacoes_criadas = created.length;
    }

    if (pagina >= totalPaginas) {
      const [movRow] = await db
        .select({ n: count() })
        .from(movimentacao)
        .where(eq(movimentacao.arquivoIngestaoId, arquivoId));
      const movTotal = Number(movRow?.n ?? 0);
      if (movTotal === 0) {
        const detail = {
          codigo: "PDF_SEM_TEXTO_E_VISAO_FALHOU" as const,
          mensagem:
            "Não foi possível extrair dados deste PDF (scan ou formato não suportado).",
          causaTecnica: "Nenhuma movimentação válida após processar todas as páginas.",
        };
        await db
          .update(arquivoIngestao)
          .set({
            status: ARQUIVO_INGESTAO_STATUS.ERRO,
            erroMensagem: detail.mensagem,
            updatedAt: new Date(),
          })
          .where(eq(arquivoIngestao.id, arquivoId));
        throw new IngestError(detail);
      }
      await db
        .update(arquivoIngestao)
        .set({ status: ARQUIVO_INGESTAO_STATUS.CONCLUIDO, updatedAt: new Date() })
        .where(eq(arquivoIngestao.id, arquivoId));
    }

    ingestLog("info", {
      fase: "concluido",
      arquivoId,
      filename,
      pagina,
      duracaoMs: Date.now() - t0,
      movimentacoes_criadas,
    });

    return {
      pagina,
      totalPaginas,
      movimentacoes_criadas,
      ...(linhasIgnoradasSemDoc > 0 ? { linhas_ignoradas_sem_doc: linhasIgnoradasSemDoc } : {}),
    };
  } catch (error) {
    const ingErr = toIngestError(error);
    ingestLog("error", {
      fase: "pdf_text",
      arquivoId,
      filename,
      pagina,
      codigoErro: ingErr.detail.codigo,
      causa: ingErr.detail.causaTecnica,
    });
    await db
      .update(arquivoIngestao)
      .set({
        status: ARQUIVO_INGESTAO_STATUS.ERRO,
        erroMensagem: ingErr.detail.mensagem,
        updatedAt: new Date(),
      })
      .where(eq(arquivoIngestao.id, arquivoId));
    throw ingErr;
  }
}
