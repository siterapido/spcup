import {
  cadastroConflito,
  CADASTRO_CONFLITO_STATUS,
  type Db,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";
import { desc, eq } from "drizzle-orm";

import { rematchPendingMovimentacoes } from "./rematch";

export type ConflitoResolucao = "MANTER_NOME" | "ATUALIZAR_NOME" | "IGNORADO";

export async function listCadastroConflitos(
  db: Db,
  status: string = CADASTRO_CONFLITO_STATUS.PENDENTE,
) {
  return db
    .select()
    .from(cadastroConflito)
    .where(eq(cadastroConflito.status, status))
    .orderBy(desc(cadastroConflito.createdAt));
}

export async function resolveCadastroConflito(
  db: Db,
  conflitoId: string,
  resolucao: ConflitoResolucao,
) {
  const rows = await db
    .select()
    .from(cadastroConflito)
    .where(eq(cadastroConflito.id, conflitoId))
    .limit(1);
  const conflito = rows[0];
  if (!conflito) {
    throw new Error(`Conflito ${conflitoId} não encontrado`);
  }
  if (conflito.status !== CADASTRO_CONFLITO_STATUS.PENDENTE) {
    throw new Error(`Conflito ${conflitoId} já foi resolvido`);
  }

  if (resolucao === "ATUALIZAR_NOME") {
    if (conflito.tipo === "PF" && conflito.pessoaFisicaId) {
      await db
        .update(pessoaFisica)
        .set({ nome: conflito.nomeProposto, updatedAt: new Date() })
        .where(eq(pessoaFisica.id, conflito.pessoaFisicaId));
    } else if (conflito.tipo === "PJ" && conflito.pessoaJuridicaId) {
      await db
        .update(pessoaJuridica)
        .set({ razaoSocial: conflito.nomeProposto, updatedAt: new Date() })
        .where(eq(pessoaJuridica.id, conflito.pessoaJuridicaId));
    }
  }

  const status =
    resolucao === "IGNORADO"
      ? CADASTRO_CONFLITO_STATUS.IGNORADO
      : CADASTRO_CONFLITO_STATUS.RESOLVIDO;

  const [updated] = await db
    .update(cadastroConflito)
    .set({
      status,
      resolucao: resolucao === "IGNORADO" ? null : resolucao,
      resolvedAt: new Date(),
    })
    .where(eq(cadastroConflito.id, conflitoId))
    .returning();

  if (
    resolucao === "ATUALIZAR_NOME" &&
    conflito.ufContexto !== "—" &&
    conflito.exercicioContexto !== 0
  ) {
    await rematchPendingMovimentacoes(
      db,
      conflito.ufContexto,
      conflito.exercicioContexto,
    );
  }

  return updated;
}
