import type { Db } from "@spc-up/db";
import { arquivoIngestao, ingestaoLinhaPendente, ingestaoPagina, movimentacao } from "@spc-up/db";
import { and, count, eq } from "drizzle-orm";

import type { ExtractStructuredOptions } from "../ai/openrouter";
import {
  resolveExtratoModel,
  resolveSecondaryExtratoModel,
} from "../ai/openrouter";
import { applyDeterministicMatch } from "../match/rules";
import { readArquivoIngestaoBuffer } from "../storage/read-arquivo";
import {
  dualExtractPage,
  INGESTAO_PAGINA_STATUS,
  transactionConsensusKey,
  type DualExtractCandidate,
  type IngestaoPaginaStatus,
} from "./dual-extract";
import { upsertIngestaoPagina } from "./ingestao-pagina";
import { IngestError, toIngestError } from "./errors";
import { fileHashBuffer } from "./hash";
import { ingestLog } from "./log";
import { persistTransactions } from "./ofx";
import { rowsFromExtratoTransactions } from "./pdf";
import { extractPdfText } from "./pdf-text";
import { renderPdfPageToPng } from "./pdf-render";
import { assertSinglePdfProcessingInSessao } from "./pdf-sessao-lock";
import { extractSinglePageBuffer, getPdfPageCount } from "./pdf-split";
import type { IngestBufferParams } from "./pipeline";
import type { ParsedTransactionRow, PrestadorContext } from "./types";
import { ARQUIVO_INGESTAO_STATUS } from "./types";

export type ArmazenarPdfResult = {
  arquivoId: string;
  pageCount: number;
  nome: string;
};

export type ProcessarPaginaPdfModo = "auto" | "texto" | "imagem";

export type ProcessarPaginaPdfOptions = ExtractStructuredOptions & {
  force?: boolean;
  modo?: ProcessarPaginaPdfModo;
};

export type IncertaPreview = {
  id: string;
  score: number;
  motivo: string;
  preview: { data?: string; valor?: unknown; direcao?: string; nome?: string };
};

export type ProcessarPaginaPdfResult = {
  pagina: number;
  totalPaginas: number;
  movimentacoes_criadas: number;
  linhas_ignoradas_sem_doc?: number;
  statusPagina: IngestaoPaginaStatus;
  modo: "texto" | "imagem";
  linhas_incertas?: number;
  incertas?: IncertaPreview[];
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

export async function finalizeArquivoIfLastPage(
  db: Db,
  arquivoId: string,
  pagina: number,
  totalPaginas: number,
): Promise<void> {
  if (pagina < totalPaginas) {
    return;
  }

  const [movRow] = await db
    .select({ n: count() })
    .from(movimentacao)
    .where(eq(movimentacao.arquivoIngestaoId, arquivoId));
  const movTotal = Number(movRow?.n ?? 0);

  const paginaRows = await db
    .select({ status: ingestaoPagina.status })
    .from(ingestaoPagina)
    .where(eq(ingestaoPagina.arquivoIngestaoId, arquivoId));

  const hasOk = paginaRows.some((r) => r.status === INGESTAO_PAGINA_STATUS.OK);
  const hasNaoTransacional = paginaRows.some(
    (r) => r.status === INGESTAO_PAGINA_STATUS.NAO_TRANSACIONAL,
  );
  const hasVerificar = paginaRows.some(
    (r) => r.status === INGESTAO_PAGINA_STATUS.VERIFICAR,
  );
  const allErro =
    paginaRows.length > 0 &&
    paginaRows.every((r) => r.status === INGESTAO_PAGINA_STATUS.ERRO);

  if (allErro || (movTotal === 0 && !hasOk && !hasNaoTransacional && !hasVerificar)) {
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

/** Extract and persist one 1-based page of a stored extrato PDF (dual-model). */
export async function processarPaginaPdfExtrato(
  db: Db,
  arquivoId: string,
  pagina: number,
  prestador: PrestadorContext,
  options?: ProcessarPaginaPdfOptions,
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

  if (arquivo.sessaoPrestacaoId) {
    await assertSinglePdfProcessingInSessao(
      db,
      arquivo.sessaoPrestacaoId,
      arquivoId,
    );
  }

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
    const { text, hasEnoughText } = await extractPdfText(pageBuffer);
    const modoProcessamento = options?.modo ?? "auto";

    if (modoProcessamento === "texto" && !hasEnoughText) {
      throw new Error(
        "Página não possui texto suficiente para extração dual (use processar-imagem).",
      );
    }

    const useText =
      modoProcessamento === "texto" ||
      (modoProcessamento === "auto" && hasEnoughText);
    const pngBuffer = useText
      ? undefined
      : await renderPdfPageToPng(pageBuffer, 1, { scale: 2 });

    const extractOpts: ExtractStructuredOptions = {
      ...options,
      filename,
      skipCache: options?.force === true,
    };

    const dual = await dualExtractPage({
      pageBuffer,
      pngBuffer,
      text,
      hasEnoughText: useText,
      filename,
      page1Based: pagina,
      options: extractOpts,
      fullBuffer: buffer,
    });

    await db
      .delete(ingestaoLinhaPendente)
      .where(
        and(
          eq(ingestaoLinhaPendente.arquivoIngestaoId, arquivoId),
          eq(ingestaoLinhaPendente.pagina, pagina),
        ),
      );

    const primaryModel = resolveExtratoModel(extractOpts);
    const secondaryModel = resolveSecondaryExtratoModel();

    for (const item of dual.aceitas) {
      item.item.__batch_pagina = pagina;
    }

    const extraction = {
      transacoes: dual.aceitas.map((a) => a.item),
    };

    const metaByKey = new Map<string, DualExtractCandidate>();
    for (const candidate of dual.aceitas) {
      const key = transactionConsensusKey(candidate.item);
      if (key) {
        metaByKey.set(key, candidate);
      }
    }

    const { rows: parsedRows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(
      extraction,
      {
        attachOrigem: dual.modo === "imagem",
        arquivoIngestaoId: arquivoId,
        nomeArquivo: filename,
        pageCount: totalPaginas,
      },
    );

    const rowsWithMeta: ParsedTransactionRow[] = parsedRows.map((row) => {
      const data = row.dataMovimento.toISOString().slice(0, 10);
      const direcao = row.direcao.toUpperCase();
      const cents = Math.round(Math.abs(Number.parseFloat(row.valor)) * 100);
      const key = `${data}|${cents}|${direcao}`;
      const candidate = metaByKey.get(key);
      const dualMeta = {
        modo: "dual" as const,
        consenso: candidate?.consenso ?? false,
        score: candidate?.score ?? 0,
        modelo_primario: primaryModel,
        modelo_secundario: secondaryModel ?? "none",
        modelo_origem_linha: candidate?.modeloOrigem ?? "revisor",
        motivo: candidate?.motivo,
      };
      const noteStr = candidate?.motivo ? ` [Nota: ${candidate.motivo}]` : "";
      const batchPagina = Number(candidate?.item?.__batch_pagina ?? pagina);
      const rowOrigem = row.origemExtracao || {
        versao: 1 as const,
        arquivoIngestaoId: arquivoId,
        nomeArquivo: filename,
        pagina: Number.isFinite(batchPagina) && batchPagina >= 1 ? batchPagina : 1,
        indiceLinha: Number(candidate?.item?.indice_linha ?? 1),
      };
      return {
        ...row,
        descricaoRaw: row.descricaoRaw + noteStr,
        confiancaGlobal: candidate?.score ?? 0,
        origemExtracao: { ...rowOrigem, dual: dualMeta },
      };
    });

    let movimentacoes_criadas = 0;
    if (rowsWithMeta.length > 0) {
      const created = await persistTransactions(
        db,
        arquivo.uf,
        arquivo.exercicio,
        arquivoId,
        rowsWithMeta,
        prestador,
      );
      for (const mov of created) {
        await applyDeterministicMatch(db, mov.id);
      }
      movimentacoes_criadas = created.length;
    }

    const insertedPendentes: IncertaPreview[] = [];
    for (const pend of dual.pendentes) {
      pend.item.__batch_pagina = pagina;
      const [row] = await db
        .insert(ingestaoLinhaPendente)
        .values({
          arquivoIngestaoId: arquivoId,
          pagina,
          payload: pend.item,
          score: pend.score,
          motivo: pend.motivo.slice(0, 64),
          snapshot: pend.snapshot ?? null,
        })
        .returning({ id: ingestaoLinhaPendente.id });
      if (row) {
        insertedPendentes.push({
          id: row.id,
          score: pend.score,
          motivo: pend.motivo,
          preview: {
            data: String(pend.item.data ?? ""),
            valor: pend.item.valor,
            direcao: String(pend.item.direcao ?? ""),
            nome: String(pend.item.remetente_destinatario ?? ""),
          },
        });
      }
    }

    await upsertIngestaoPagina(db, arquivoId, pagina, {
      status: dual.statusPagina,
      modo: dual.modo,
      aceitas: movimentacoes_criadas,
      incertas: dual.pendentes.length,
      motivo: dual.motivo,
      textoAmostra: dual.textoAmostra,
    });

    await finalizeArquivoIfLastPage(db, arquivoId, pagina, totalPaginas);

    ingestLog("info", {
      fase: "concluido",
      arquivoId,
      filename,
      pagina,
      duracaoMs: Date.now() - t0,
      movimentacoes_criadas,
      statusPagina: dual.statusPagina,
      modo: dual.modo,
    });

    return {
      pagina,
      totalPaginas,
      movimentacoes_criadas,
      statusPagina: dual.statusPagina,
      modo: dual.modo,
      ...(linhasIgnoradasSemDoc > 0 ? { linhas_ignoradas_sem_doc: linhasIgnoradasSemDoc } : {}),
      ...(dual.pendentes.length > 0
        ? { linhas_incertas: dual.pendentes.length, incertas: insertedPendentes }
        : {}),
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
    await upsertIngestaoPagina(db, arquivoId, pagina, {
      status: INGESTAO_PAGINA_STATUS.ERRO,
      modo: "texto",
      aceitas: 0,
      incertas: 0,
      motivo: ingErr.detail.causaTecnica,
    }).catch(() => undefined);
    throw ingErr;
  }
}

/** Mark a page as ignored: drop pending lines and set ingestao_pagina to OK. */
export async function ignorarPaginaPdfExtrato(
  db: Db,
  arquivoId: string,
  pagina: number,
): Promise<void> {
  await db
    .delete(ingestaoLinhaPendente)
    .where(
      and(
        eq(ingestaoLinhaPendente.arquivoIngestaoId, arquivoId),
        eq(ingestaoLinhaPendente.pagina, pagina),
      ),
    );

  const existing = await db
    .select({ modo: ingestaoPagina.modo })
    .from(ingestaoPagina)
    .where(
      and(
        eq(ingestaoPagina.arquivoIngestaoId, arquivoId),
        eq(ingestaoPagina.pagina, pagina),
      ),
    )
    .limit(1);

  await upsertIngestaoPagina(db, arquivoId, pagina, {
    status: INGESTAO_PAGINA_STATUS.OK,
    modo: existing[0]?.modo === "imagem" ? "imagem" : "texto",
    aceitas: 0,
    incertas: 0,
    motivo: "Ignorado pelo operador",
  });
}

/** Load PNG bytes for a stored PDF page (for GET .../imagem). */
export async function loadPaginaPdfComoPng(
  db: Db,
  arquivoId: string,
  pagina: number,
): Promise<Buffer> {
  const rows = await db
    .select()
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.id, arquivoId))
    .limit(1);
  const arquivo = rows[0];
  if (!arquivo) {
    throw new Error(`Arquivo de ingestão não encontrado: ${arquivoId}`);
  }
  const buffer = await readArquivoIngestaoBuffer(arquivo.caminhoStorage);
  const pageBuffer = await extractSinglePageBuffer(buffer, pagina);
  return renderPdfPageToPng(pageBuffer, 1, { scale: 2 });
}
