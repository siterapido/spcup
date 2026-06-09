import { movimentacao, sessaoPrestacao, type Db } from "@spc-up/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { purgeSessaoData } from "./purge-sessao-data";

export { purgeSessaoData } from "./purge-sessao-data";

export const SESSAO_DELETE_CODES = {
  NOT_FOUND: "SESSAO_NOT_FOUND",
  DELETED: "SESSAO_ALREADY_DELETED",
  COM_EXPORTADAS: "SESSAO_COM_EXPORTADAS",
} as const;

export type SoftDeleteSessaoSkipped = {
  id: string;
  reason: string;
  code: string;
};

export type SoftDeleteSessoesResult = {
  deleted: number;
  skipped: SoftDeleteSessaoSkipped[];
};

async function hasExportedMovimentacoes(db: Db, sessaoId: string): Promise<boolean> {
  const rows = await db
    .select({ id: movimentacao.id })
    .from(movimentacao)
    .where(
      and(
        eq(movimentacao.sessaoPrestacaoId, sessaoId),
        eq(movimentacao.status, "EXPORTADO"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Remove prestações soft-deleted que ainda ocupam o banco. */
export async function purgeSoftDeletedSessoes(db: Db): Promise<number> {
  const rows = await db
    .select({ id: sessaoPrestacao.id })
    .from(sessaoPrestacao)
    .where(isNotNull(sessaoPrestacao.deletedAt));
  let purged = 0;
  for (const row of rows) {
    if (await hasExportedMovimentacoes(db, row.id)) {
      continue;
    }
    await purgeSessaoData(db, row.id);
    purged += 1;
  }
  return purged;
}

/** Exclui prestação e dados vinculados do banco (não soft delete). */
export async function softDeleteSessoes(
  db: Db,
  ids: string[],
): Promise<SoftDeleteSessoesResult> {
  const skipped: SoftDeleteSessaoSkipped[] = [];
  let deleted = 0;
  const seen = new Set<string>();
  const uniqueIds = ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (uniqueIds.length === 0) {
    return { deleted: 0, skipped };
  }

  const sessoes = await db.query.sessaoPrestacao.findMany({
    where: inArray(sessaoPrestacao.id, uniqueIds),
    columns: { id: true, deletedAt: true },
  });
  const byId = new Map(sessoes.map((s) => [s.id, s]));

  for (const id of uniqueIds) {
    const sessao = byId.get(id);
    if (!sessao) {
      skipped.push({
        id,
        reason: "Prestação não encontrada",
        code: SESSAO_DELETE_CODES.NOT_FOUND,
      });
      continue;
    }

    if (await hasExportedMovimentacoes(db, id)) {
      skipped.push({
        id,
        reason:
          "Prestação possui movimentações exportadas; não pode ser excluída",
        code: SESSAO_DELETE_CODES.COM_EXPORTADAS,
      });
      continue;
    }

    await purgeSessaoData(db, id);
    deleted += 1;
  }

  return { deleted, skipped };
}
