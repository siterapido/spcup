import {
  consolidacaoEvento,
  movimentacao,
  sessaoPrestacao,
  type Db,
} from "@spc-up/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

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
        isNull(movimentacao.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Soft-delete prestação e dados vinculados (movimentações e eventos de consolidação). */
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
    if (sessao.deletedAt != null) {
      skipped.push({
        id,
        reason: "Prestação já excluída",
        code: SESSAO_DELETE_CODES.DELETED,
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

    const now = new Date();
    await db
      .update(movimentacao)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(eq(movimentacao.sessaoPrestacaoId, id), isNull(movimentacao.deletedAt)),
      );
    await db
      .update(consolidacaoEvento)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(consolidacaoEvento.sessaoPrestacaoId, id),
          isNull(consolidacaoEvento.deletedAt),
        ),
      );
    await db
      .update(sessaoPrestacao)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(sessaoPrestacao.id, id));
    deleted += 1;
  }

  return { deleted, skipped };
}
