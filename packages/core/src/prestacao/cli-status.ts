import { arquivoIngestao, movimentacao, type Db } from "@spc-up/db";
import { and, count, eq, ne } from "drizzle-orm";

import { listConsolidacaoForSessao } from "../consolidacao/queries";
import {
  ARQUIVO_INGESTAO_STATUS,
  MOVIMENTACAO_STATUS,
} from "../ingest/types";
import { getSessao } from "./sessao";

export type PrestacaoCliStatus = {
  sessaoId: string;
  uf: string;
  exercicio: number;
  status: string;
  consolidarExtratos: boolean;
  arquivos: Array<{
    id: string;
    nome: string;
    status: string;
    movimentacoes: number;
  }>;
  movimentacoesTotal: number;
  movimentacoesPendentes: number;
  pdfPendentes: number;
  consolidacaoEventos: number;
  kanbanPath: string;
  consolidacaoPath: string;
};

export async function getPrestacaoCliStatus(
  db: Db,
  sessaoId: string,
): Promise<PrestacaoCliStatus> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao) {
    throw new Error("Sessão não encontrada");
  }

  const arquivosRows = await db.query.arquivoIngestao.findMany({
    where: eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
  });

  const arquivos = await Promise.all(
    arquivosRows.map(async (arq) => {
      const [row] = await db
        .select({ value: count() })
        .from(movimentacao)
        .where(eq(movimentacao.arquivoIngestaoId, arq.id));
      return {
        id: arq.id,
        nome: arq.nomeArquivo,
        status: arq.status,
        movimentacoes: Number(row?.value ?? 0),
      };
    }),
  );

  const [totalRow] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(eq(movimentacao.sessaoPrestacaoId, sessaoId));

  const [pendentesRow] = await db
    .select({ pendentes: count() })
    .from(movimentacao)
    .where(
      and(
        eq(movimentacao.sessaoPrestacaoId, sessaoId),
        ne(movimentacao.status, MOVIMENTACAO_STATUS.CONFIRMADO),
      ),
    );

  const pdfPendentes = arquivosRows.filter(
    (arq) =>
      /\.pdf$/i.test(arq.nomeArquivo) &&
      (arq.status === ARQUIVO_INGESTAO_STATUS.PENDENTE ||
        arq.status === ARQUIVO_INGESTAO_STATUS.PROCESSANDO),
  ).length;

  const consolidacao = await listConsolidacaoForSessao(db, sessaoId);

  return {
    sessaoId,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    status: sessao.status,
    consolidarExtratos: sessao.consolidarExtratos,
    arquivos,
    movimentacoesTotal: Number(totalRow?.total ?? 0),
    movimentacoesPendentes: Number(pendentesRow?.pendentes ?? 0),
    pdfPendentes,
    consolidacaoEventos: consolidacao.eventos.length,
    kanbanPath: `/prestacao/${sessaoId}/kanban`,
    consolidacaoPath: `/prestacao/${sessaoId}/consolidacao`,
  };
}
