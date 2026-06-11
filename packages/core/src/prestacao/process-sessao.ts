import { arquivoIngestao, type Db } from "@spc-up/db";
import { and, eq, inArray } from "drizzle-orm";

import { consolidateSession } from "../consolidacao/run";
import {
  processarPaginaPdfExtrato,
  type ProcessarPaginaPdfResult,
} from "../ingest/pdf-pagina";
import type { ExtratoColumnMap } from "../ingest/extrato-column-map";
import type { ExtratoModeloId } from "../ingest/extrato-modelo";
import { ARQUIVO_INGESTAO_STATUS, type PrestadorContext } from "../ingest/types";
import { persistArquivoBaseOnProcessStart } from "./resolve-arquivo-base";
import { getSessao, prestadorFromSessao } from "./sessao";

export type ProcessPdfArquivoResult = {
  arquivoId: string;
  nome: string;
  paginas: ProcessarPaginaPdfResult[];
  movimentacoes_criadas?: number;
  erro?: string;
};

export type ProcessSessaoResult = {
  sessaoId: string;
  uf: string;
  exercicio: number;
  consolidarExtratos: boolean;
  arquivos: ProcessPdfArquivoResult[];
  movimentacoesTotal: number;
  paginasVerificar: number;
  consolidacao?:
    | { skipped: true; reason: string }
    | {
        skipped: false;
        eventos: number;
        autoAprovados: number;
        paraRevisar: number;
        limiarAutoAprovacao: number;
        errosAutoAprovacao?: string[];
      };
  avisos: string[];
};

async function listPendingPdfArquivos(db: Db, sessaoId: string) {
  const rows = await db
    .select()
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
        inArray(arquivoIngestao.status, [
          ARQUIVO_INGESTAO_STATUS.PENDENTE,
          ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
        ]),
      ),
    );
  return rows.filter((r) => /\.pdf$/i.test(r.nomeArquivo));
}

import { processSessaoWithNotebookLM } from "./process-sessao-notebooklm";

export type ProcessSessaoPdfOptions = {
  skipConsolidacao?: boolean;
  extratoColumnMaps?: Record<string, ExtratoColumnMap>;
  extratoModeloIds?: Record<string, ExtratoModeloId>;
  arquivoBaseIngestaoId?: string;
};

export async function processSessaoPdfArquivos(
  db: Db,
  sessaoId: string,
  options?: ProcessSessaoPdfOptions,
): Promise<ProcessSessaoResult> {
  if (process.env.USE_NOTEBOOKLM !== "false") {
    try {
      return await processSessaoWithNotebookLM(db, sessaoId, options);
    } catch (error) {
      console.warn("NotebookLM process failed. Falling back to OpenRouter:", error);
      const originalDisableOr = process.env.DISABLE_OPENROUTER;
      try {
        process.env.DISABLE_OPENROUTER = "false";
        const result = await runTraditionalPipeline(db, sessaoId, options);
        result.avisos = result.avisos ?? [];
        result.avisos.push(
          `NotebookLM falhou. Ativado fallback para OpenRouter. Erro original: ${error instanceof Error ? error.message : String(error)}`
        );
        return result;
      } finally {
        process.env.DISABLE_OPENROUTER = originalDisableOr;
      }
    }
  }

  return runTraditionalPipeline(db, sessaoId, options);
}

async function runTraditionalPipeline(
  db: Db,
  sessaoId: string,
  options?: ProcessSessaoPdfOptions,
): Promise<ProcessSessaoResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadual) {
    throw new Error("Sessão não encontrada ou sem diretório estadual");
  }

  await persistArquivoBaseOnProcessStart(
    db,
    sessaoId,
    sessao.arquivoBaseIngestaoId,
    options,
  );

  const prestadorBase = prestadorFromSessao(sessao);
  const prestador: PrestadorContext = {
    cnpjPrestador: prestadorBase.cnpjPrestador,
    tipoPrestador: prestadorBase.tipoPrestador,
    sessaoPrestacaoId: sessaoId,
    diretorioMunicipalId: prestadorBase.diretorioMunicipalId,
  };

  const avisos: string[] = [];
  const arquivos: ProcessPdfArquivoResult[] = [];
  let movimentacoesTotal = 0;
  let paginasVerificar = 0;

  const pending = await listPendingPdfArquivos(db, sessaoId);
  if (pending.length === 0) {
    avisos.push("Nenhum PDF pendente de processamento.");
  }

  let consolidacao: ProcessSessaoResult["consolidacao"];
  const runConsolidacao =
    !options?.skipConsolidacao && sessao.consolidarExtratos;

  for (const arq of pending) {
    const paginas: ProcessarPaginaPdfResult[] = [];
    try {
      let pagina = 1;
      let totalPaginas = 1;
      while (pagina <= totalPaginas) {
        const pageRes = await processarPaginaPdfExtrato(
          db,
          arq.id,
          pagina,
          prestador,
        );
        paginas.push(pageRes);
        totalPaginas = pageRes.totalPaginas;
        movimentacoesTotal += pageRes.movimentacoes_criadas;
        if (pageRes.statusPagina === "VERIFICAR") {
          paginasVerificar += 1;
        }
        pagina += 1;
      }
      arquivos.push({ arquivoId: arq.id, nome: arq.nomeArquivo, paginas });

      if (runConsolidacao) {
        consolidacao = await consolidateSession(db, sessaoId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      arquivos.push({
        arquivoId: arq.id,
        nome: arq.nomeArquivo,
        paginas,
        erro: message,
      });
    }
  }

  if (options?.skipConsolidacao) {
    consolidacao = { skipped: true, reason: "SKIP_FLAG" };
  } else if (!runConsolidacao) {
    consolidacao = await consolidateSession(db, sessaoId);
  } else if (consolidacao == null) {
    consolidacao = { skipped: true, reason: "NO_PDF_PROCESSED" };
  }

  return {
    sessaoId,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    consolidarExtratos: sessao.consolidarExtratos,
    arquivos,
    movimentacoesTotal,
    paginasVerificar,
    consolidacao,
    avisos,
  };
}
