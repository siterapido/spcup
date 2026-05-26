import {
  arquivoIngestao,
  cadastroConflito,
  diretorioEstadual,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
  sessaoPrestacao,
  type Db,
} from "@spc-up/db";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";

import { STUB_PF_NOME, STUB_PJ_RAZAO } from "../cadastro/constants";
import { canExport } from "../export/guard";
import { isPlaceholderCnpjPrestador } from "../prestacao/constants";

export interface ConfiancaFaixas {
  abaixo60: number;
  entre60e85: number;
  acima85: number;
}

export interface SystemStatsScope {
  movimentacoesPorStatus: Record<string, number>;
  movimentacoesBloqueadas: number;
  confiancaFaixas: ConfiancaFaixas;
  arquivosPorStatus: Record<string, number>;
  exportavel: boolean;
}

export interface SystemStatsGlobal {
  movimentacoesPorStatus: Record<string, number>;
  movimentacoesBloqueadas: number;
  confiancaFaixas: ConfiancaFaixas;
  arquivosPorStatus: Record<string, number>;
  conflitosPendentes: number;
  pessoasPf: number;
  pessoasPj: number;
  pessoasStub: number;
  sessoesAbertas: number;
  diretoriosPlaceholder: number;
}

export interface SystemStats {
  global: SystemStatsGlobal;
  scoped: SystemStatsScope;
  uf: string;
  exercicio: number;
}

function rowsToRecord(rows: Array<{ key: string; total: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    out[row.key] = row.total;
  }
  return out;
}

async function countMovimentacoesByStatus(
  db: Db,
  filter?: { uf: string; exercicio: number },
): Promise<Record<string, number>> {
  const base = db
    .select({ key: movimentacao.status, total: count() })
    .from(movimentacao)
    .$dynamic();
  const rows = filter
    ? await base
        .where(and(eq(movimentacao.uf, filter.uf), eq(movimentacao.exercicio, filter.exercicio)))
        .groupBy(movimentacao.status)
    : await base.groupBy(movimentacao.status);
  return rowsToRecord(rows.map((r) => ({ key: r.key, total: Number(r.total) })));
}

async function countArquivosByStatus(
  db: Db,
  filter?: { uf: string; exercicio: number },
): Promise<Record<string, number>> {
  const base = db
    .select({ key: arquivoIngestao.status, total: count() })
    .from(arquivoIngestao)
    .$dynamic();
  const rows = filter
    ? await base
        .where(
          and(eq(arquivoIngestao.uf, filter.uf), eq(arquivoIngestao.exercicio, filter.exercicio)),
        )
        .groupBy(arquivoIngestao.status)
    : await base.groupBy(arquivoIngestao.status);
  return rowsToRecord(rows.map((r) => ({ key: r.key, total: Number(r.total) })));
}

async function countConfiancaFaixas(
  db: Db,
  filter?: { uf: string; exercicio: number },
): Promise<ConfiancaFaixas> {
  const scope = filter
    ? [eq(movimentacao.uf, filter.uf), eq(movimentacao.exercicio, filter.exercicio)]
    : [];

  const [abaixo60Row] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(and(...scope, lt(movimentacao.confiancaGlobal, 0.6)));
  const [entreRow] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(
      and(
        ...scope,
        gte(movimentacao.confiancaGlobal, 0.6),
        lt(movimentacao.confiancaGlobal, 0.85),
      ),
    );
  const [acimaRow] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(and(...scope, gte(movimentacao.confiancaGlobal, 0.85)));

  return {
    abaixo60: Number(abaixo60Row?.total ?? 0),
    entre60e85: Number(entreRow?.total ?? 0),
    acima85: Number(acimaRow?.total ?? 0),
  };
}

async function countMovimentacoesBloqueadas(
  db: Db,
  filter?: { uf: string; exercicio: number },
): Promise<number> {
  const conditions = [eq(movimentacao.bloqueioExport, true)];
  if (filter) {
    conditions.push(eq(movimentacao.uf, filter.uf), eq(movimentacao.exercicio, filter.exercicio));
  }
  const [row] = await db
    .select({ total: count() })
    .from(movimentacao)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

export async function getSystemStats(
  db: Db,
  options: { uf: string; exercicio: number },
): Promise<SystemStats> {
  const uf = options.uf.toUpperCase();
  const exercicio = options.exercicio;
  const scopedFilter = { uf, exercicio };

  const [
    globalMovStatus,
    globalArqStatus,
    globalConfianca,
    globalBloqueadas,
    scopedMovStatus,
    scopedArqStatus,
    scopedConfianca,
    scopedBloqueadas,
    conflitosRow,
    pfRow,
    pjRow,
    stubPfRow,
    stubPjRow,
    sessoesRow,
    estaduais,
    exportavel,
  ] = await Promise.all([
    countMovimentacoesByStatus(db),
    countArquivosByStatus(db),
    countConfiancaFaixas(db),
    countMovimentacoesBloqueadas(db),
    countMovimentacoesByStatus(db, scopedFilter),
    countArquivosByStatus(db, scopedFilter),
    countConfiancaFaixas(db, scopedFilter),
    countMovimentacoesBloqueadas(db, scopedFilter),
    db
      .select({ total: count() })
      .from(cadastroConflito)
      .where(eq(cadastroConflito.status, "PENDENTE")),
    db.select({ total: count() }).from(pessoaFisica),
    db.select({ total: count() }).from(pessoaJuridica),
    db
      .select({ total: count() })
      .from(pessoaFisica)
      .where(eq(pessoaFisica.nome, STUB_PF_NOME)),
    db
      .select({ total: count() })
      .from(pessoaJuridica)
      .where(eq(pessoaJuridica.razaoSocial, STUB_PJ_RAZAO)),
    db
      .select({ total: count() })
      .from(sessaoPrestacao)
      .where(inArray(sessaoPrestacao.status, ["ABERTA", "EM_PROCESSAMENTO"])),
    db.select().from(diretorioEstadual),
    canExport(db, uf, exercicio),
  ]);

  const diretoriosPlaceholder = estaduais.filter((d) =>
    isPlaceholderCnpjPrestador(d.cnpjPrestador),
  ).length;

  return {
    uf,
    exercicio,
    global: {
      movimentacoesPorStatus: globalMovStatus,
      movimentacoesBloqueadas: globalBloqueadas,
      confiancaFaixas: globalConfianca,
      arquivosPorStatus: globalArqStatus,
      conflitosPendentes: Number(conflitosRow[0]?.total ?? 0),
      pessoasPf: Number(pfRow[0]?.total ?? 0),
      pessoasPj: Number(pjRow[0]?.total ?? 0),
      pessoasStub: Number(stubPfRow[0]?.total ?? 0) + Number(stubPjRow[0]?.total ?? 0),
      sessoesAbertas: Number(sessoesRow[0]?.total ?? 0),
      diretoriosPlaceholder,
    },
    scoped: {
      movimentacoesPorStatus: scopedMovStatus,
      movimentacoesBloqueadas: scopedBloqueadas,
      confiancaFaixas: scopedConfianca,
      arquivosPorStatus: scopedArqStatus,
      exportavel,
    },
  };
}
