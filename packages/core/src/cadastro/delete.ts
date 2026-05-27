import {
  type Db,
  cadastroConflito,
  consolidacaoEvento,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";
import { eq, sql } from "drizzle-orm";

import type { CadastroTipo } from "./constants";

export type PessoaRef = { id: string; tipo: CadastroTipo };

export type DeletePessoasSkipped = PessoaRef & { reason: string };

export type DeletePessoasResult = {
  deleted: number;
  skipped: DeletePessoasSkipped[];
};

async function countMovimentacoes(db: Db, id: string, tipo: CadastroTipo) {
  const col =
    tipo === "PF" ? movimentacao.pessoaFisicaId : movimentacao.pessoaJuridicaId;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(movimentacao)
    .where(eq(col, id));
  return rows[0]?.count ?? 0;
}

async function countConsolidacao(db: Db, id: string, tipo: CadastroTipo) {
  const col =
    tipo === "PF"
      ? consolidacaoEvento.pessoaFisicaId
      : consolidacaoEvento.pessoaJuridicaId;
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(consolidacaoEvento)
    .where(eq(col, id));
  return rows[0]?.count ?? 0;
}

export async function deletePessoas(
  db: Db,
  items: PessoaRef[],
): Promise<DeletePessoasResult> {
  const skipped: DeletePessoasSkipped[] = [];
  let deleted = 0;
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${item.tipo}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const movCount = await countMovimentacoes(db, item.id, item.tipo);
    if (movCount > 0) {
      skipped.push({
        ...item,
        reason: "Possui movimentações vinculadas",
      });
      continue;
    }

    const consolCount = await countConsolidacao(db, item.id, item.tipo);
    if (consolCount > 0) {
      skipped.push({
        ...item,
        reason: "Possui consolidação vinculada",
      });
      continue;
    }

    if (item.tipo === "PF") {
      const exists = await db
        .select({ id: pessoaFisica.id })
        .from(pessoaFisica)
        .where(eq(pessoaFisica.id, item.id))
        .limit(1);
      if (!exists[0]) {
        skipped.push({ ...item, reason: "Cadastro não encontrado" });
        continue;
      }
      await db
        .delete(cadastroConflito)
        .where(eq(cadastroConflito.pessoaFisicaId, item.id));
      await db.delete(pessoaFisica).where(eq(pessoaFisica.id, item.id));
    } else {
      const exists = await db
        .select({ id: pessoaJuridica.id })
        .from(pessoaJuridica)
        .where(eq(pessoaJuridica.id, item.id))
        .limit(1);
      if (!exists[0]) {
        skipped.push({ ...item, reason: "Cadastro não encontrado" });
        continue;
      }
      await db
        .delete(cadastroConflito)
        .where(eq(cadastroConflito.pessoaJuridicaId, item.id));
      await db.delete(pessoaJuridica).where(eq(pessoaJuridica.id, item.id));
    }

    deleted += 1;
  }

  return { deleted, skipped };
}
