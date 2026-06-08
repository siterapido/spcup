import {
  INGESTAO_PAGINA_STATUS,
  arquivoIngestao,
  ingestaoPagina,
  movimentacao,
  type Db,
} from "@spc-up/db";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";

import type {
  IngestaoResumo,
  IngestaoResumoArquivo,
  IngestaoResumoPagina,
  PlanilhaLinha,
  PlanilhaResumo,
} from "./types";

export function readLinhasIgnoradasSemDoc(metadados: unknown): number {
  if (!metadados || typeof metadados !== "object") return 0;
  const value = (metadados as Record<string, unknown>).linhas_ignoradas_sem_doc;
  return typeof value === "number" ? value : 0;
}

export type IngestaoMetadadosLido = {
  linhasIgnoradasSemDoc: number;
  avisosBalance: string[];
  motor: string | null;
  transacoesExtraidas: number | null;
};

export function readIngestaoMetadados(metadados: unknown): IngestaoMetadadosLido {
  if (!metadados || typeof metadados !== "object") {
    return {
      linhasIgnoradasSemDoc: 0,
      avisosBalance: [],
      motor: null,
      transacoesExtraidas: null,
    };
  }

  const record = metadados as Record<string, unknown>;
  const avisosRaw = record.avisos_balance;
  const avisosBalance = Array.isArray(avisosRaw)
    ? avisosRaw.filter((v): v is string => typeof v === "string")
    : [];

  return {
    linhasIgnoradasSemDoc: readLinhasIgnoradasSemDoc(metadados),
    avisosBalance,
    motor: typeof record.motor === "string" ? record.motor : null,
    transacoesExtraidas:
      typeof record.transacoes_extraidas === "number" ? record.transacoes_extraidas : null,
  };
}

/** Conta linhas da planilha atribuíveis a cada arquivo via origens. */
export function countLinhasPlanilhaPorArquivo(
  linhas: PlanilhaLinha[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const linha of linhas) {
    const arquivoIds = new Set<string>();
    for (const origem of linha.origens) {
      if (origem.arquivoIngestaoId) {
        arquivoIds.add(origem.arquivoIngestaoId);
      }
    }
    if (arquivoIds.size === 0) continue;
    for (const id of arquivoIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function mapPagina(row: {
  pagina: number;
  status: string;
  aceitas: number;
  incertas: number;
  motivo: string | null;
}): IngestaoResumoPagina {
  return {
    pagina: row.pagina,
    status: row.status,
    aceitas: row.aceitas,
    incertas: row.incertas,
    motivo: row.motivo,
  };
}

export async function buildIngestaoResumo(
  db: Db,
  sessaoId: string,
  linhas: PlanilhaLinha[],
  resumo?: PlanilhaResumo,
): Promise<IngestaoResumo> {
  const arquivosRows = await db.query.arquivoIngestao.findMany({
    where: eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
    orderBy: [asc(arquivoIngestao.nomeArquivo)],
  });

  const arquivoIds = arquivosRows.map((a) => a.id);

  const [movTotalRow] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(
      and(
        eq(movimentacao.sessaoPrestacaoId, sessaoId),
        isNull(movimentacao.deletedAt),
        isNull(movimentacao.movimentacaoCanonicaId),
      ),
    );

  const movCountsByArquivo = new Map<string, number>();
  if (arquivoIds.length > 0) {
    const movRows = await db
      .select({
        arquivoIngestaoId: movimentacao.arquivoIngestaoId,
        total: count(),
      })
      .from(movimentacao)
      .where(
        and(
          inArray(movimentacao.arquivoIngestaoId, arquivoIds),
          isNull(movimentacao.deletedAt),
          isNull(movimentacao.movimentacaoCanonicaId),
        ),
      )
      .groupBy(movimentacao.arquivoIngestaoId);

    for (const row of movRows) {
      if (row.arquivoIngestaoId) {
        movCountsByArquivo.set(row.arquivoIngestaoId, Number(row.total ?? 0));
      }
    }
  }

  const paginasByArquivo = new Map<string, IngestaoResumoPagina[]>();
  if (arquivoIds.length > 0) {
    const paginaRows = await db.query.ingestaoPagina.findMany({
      where: inArray(ingestaoPagina.arquivoIngestaoId, arquivoIds),
      orderBy: [asc(ingestaoPagina.arquivoIngestaoId), asc(ingestaoPagina.pagina)],
    });

    for (const row of paginaRows) {
      const list = paginasByArquivo.get(row.arquivoIngestaoId) ?? [];
      list.push(mapPagina(row));
      paginasByArquivo.set(row.arquivoIngestaoId, list);
    }
  }

  const linhasPorArquivo = countLinhasPlanilhaPorArquivo(linhas);

  const arquivos: IngestaoResumoArquivo[] = arquivosRows.map((arq) => {
    const paginas = paginasByArquivo.get(arq.id) ?? [];
    const paginasVerificar = paginas.filter(
      (p) => p.status === INGESTAO_PAGINA_STATUS.VERIFICAR,
    ).length;
    const meta = readIngestaoMetadados(arq.metadados);

    return {
      id: arq.id,
      nomeArquivo: arq.nomeArquivo,
      status: arq.status,
      movimentacoesExtraidas: movCountsByArquivo.get(arq.id) ?? 0,
      linhasIgnoradasSemDoc: meta.linhasIgnoradasSemDoc,
      paginasVerificar,
      linhasPlanilha: linhasPorArquivo.get(arq.id) ?? 0,
      paginas,
      motor: meta.motor,
      avisosBalance: meta.avisosBalance,
      transacoesExtraidasMetadados: meta.transacoesExtraidas,
    };
  });

  const mergesPendentes =
    resumo?.mergePendente ??
    linhas.filter((l) => l.status === "merge_pendente").length;

  return {
    movimentacoesBrutas: Number(movTotalRow?.total ?? 0),
    linhasPlanilha: linhas.length,
    mergesPendentes,
    arquivos,
  };
}
