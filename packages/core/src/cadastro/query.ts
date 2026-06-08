import { type Db, movimentacao, pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";

import type { CadastroTipo } from "./constants";

export async function searchPessoas(
  db: Db,
  q: string,
  tipo?: CadastroTipo,
  limit = 50,
) {
  const term = q.trim();
  const results: Array<{
    id: string;
    tipo: CadastroTipo;
    documento: string;
    nome: string;
    movimentacoes_count: number;
    ufs: string;
  }> = [];

  if (!tipo || tipo === "PF") {
    const pfWhere = term
      ? or(
          ilike(pessoaFisica.nome, `%${term}%`),
          ilike(pessoaFisica.cpf, `%${term.replace(/\D/g, "")}%`),
        )
      : undefined;
    const pfs = await db
      .select({
        id: pessoaFisica.id,
        documento: pessoaFisica.cpf,
        nome: pessoaFisica.nome,
        movimentacoes_count: sql<number>`(
          select count(*)::int from ${movimentacao}
          where ${movimentacao.pessoaFisicaId} = ${pessoaFisica.id}
        )`,
        ufs: sql<string>`(
          select coalesce(string_agg(distinct ${movimentacao.uf}, ', ' order by ${movimentacao.uf}), '')
          from ${movimentacao}
          where ${movimentacao.pessoaFisicaId} = ${pessoaFisica.id}
        )`,
      })
      .from(pessoaFisica)
      .where(pfWhere ? and(pfWhere, isNull(pessoaFisica.deletedAt)) : isNull(pessoaFisica.deletedAt))
      .limit(limit);

    for (const row of pfs) {
      results.push({ ...row, tipo: "PF" });
    }
  }

  if (!tipo || tipo === "PJ") {
    const pjWhere = term
      ? or(
          ilike(pessoaJuridica.razaoSocial, `%${term}%`),
          ilike(pessoaJuridica.cnpj, `%${term.replace(/[^A-Za-z0-9]/g, "")}%`),
        )
      : undefined;
    const pjs = await db
      .select({
        id: pessoaJuridica.id,
        documento: pessoaJuridica.cnpj,
        nome: pessoaJuridica.razaoSocial,
        movimentacoes_count: sql<number>`(
          select count(*)::int from ${movimentacao}
          where ${movimentacao.pessoaJuridicaId} = ${pessoaJuridica.id}
        )`,
        ufs: sql<string>`(
          select coalesce(string_agg(distinct ${movimentacao.uf}, ', ' order by ${movimentacao.uf}), '')
          from ${movimentacao}
          where ${movimentacao.pessoaJuridicaId} = ${pessoaJuridica.id}
        )`,
      })
      .from(pessoaJuridica)
      .where(pjWhere ? and(pjWhere, isNull(pessoaJuridica.deletedAt)) : isNull(pessoaJuridica.deletedAt))
      .limit(limit);

    for (const row of pjs) {
      results.push({ ...row, tipo: "PJ" });
    }
  }

  return results.slice(0, limit);
}

export async function getPessoa(db: Db, id: string, tipo: CadastroTipo) {
  if (tipo === "PF") {
    const rows = await db
      .select()
      .from(pessoaFisica)
      .where(and(eq(pessoaFisica.id, id), isNull(pessoaFisica.deletedAt)))
      .limit(1);
    const pf = rows[0];
    if (!pf) return null;
    return {
      id: pf.id,
      tipo: "PF" as const,
      documento: pf.cpf,
      nome: pf.nome,
      titulo_eleitor: pf.tituloEleitor,
      created_at: pf.createdAt,
      updated_at: pf.updatedAt,
    };
  }

  const rows = await db
    .select()
    .from(pessoaJuridica)
    .where(and(eq(pessoaJuridica.id, id), isNull(pessoaJuridica.deletedAt)))
    .limit(1);
  const pj = rows[0];
  if (!pj) return null;
  return {
    id: pj.id,
    tipo: "PJ" as const,
    documento: pj.cnpj,
    nome: pj.razaoSocial,
    titulo_eleitor: null,
    created_at: pj.createdAt,
    updated_at: pj.updatedAt,
  };
}

export async function listPessoaMovimentacoes(db: Db, id: string, tipo: CadastroTipo) {
  const condition =
    tipo === "PF"
      ? eq(movimentacao.pessoaFisicaId, id)
      : eq(movimentacao.pessoaJuridicaId, id);

  return db.query.movimentacao.findMany({
    where: condition,
    orderBy: [desc(movimentacao.dataMovimento)],
  });
}

export async function countPessoaMovimentacoes(db: Db, id: string, tipo: CadastroTipo) {
  const rows = await listPessoaMovimentacoes(db, id, tipo);
  const byUf: Record<string, number> = {};
  const byExercicio: Record<number, number> = {};
  for (const mov of rows) {
    byUf[mov.uf] = (byUf[mov.uf] ?? 0) + 1;
    byExercicio[mov.exercicio] = (byExercicio[mov.exercicio] ?? 0) + 1;
  }
  return { total: rows.length, byUf, byExercicio };
}
