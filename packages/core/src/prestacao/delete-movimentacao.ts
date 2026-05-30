import { movimentacao, type Db } from "@spc-up/db";
import { eq, inArray } from "drizzle-orm";

export const MOVIMENTACAO_DELETE_CODES = {
  EXPORTADA: "MOVIMENTACAO_EXPORTADA",
  CONFIRMADA: "MOVIMENTACAO_CONFIRMADA",
  NOT_FOUND: "MOVIMENTACAO_NOT_FOUND",
  DELETED: "MOVIMENTACAO_DELETED",
} as const;

const DELETABLE_STATUSES = new Set(["RASCUNHO", "PENDENTE_REVISAO", "REJEITADO"]);

export type SoftDeleteMovimentacaoSkipped = {
  id: string;
  reason: string;
  code: string;
};

export type SoftDeleteMovimentacoesResult = {
  deleted: number;
  skipped: SoftDeleteMovimentacaoSkipped[];
};

function skipReason(
  status: string,
  deletedAt: Date | null,
): SoftDeleteMovimentacaoSkipped | null {
  if (deletedAt != null) {
    return {
      id: "",
      reason: "Movimentação já excluída",
      code: MOVIMENTACAO_DELETE_CODES.DELETED,
    };
  }
  if (status === "EXPORTADO") {
    return {
      id: "",
      reason: "Movimentação já exportada; não pode ser excluída",
      code: MOVIMENTACAO_DELETE_CODES.EXPORTADA,
    };
  }
  if (status === "CONFIRMADO") {
    return {
      id: "",
      reason: "Movimentação confirmada; rejeite antes de excluir",
      code: MOVIMENTACAO_DELETE_CODES.CONFIRMADA,
    };
  }
  if (!DELETABLE_STATUSES.has(status)) {
    return {
      id: "",
      reason: `Status ${status} não permite exclusão`,
      code: MOVIMENTACAO_DELETE_CODES.NOT_FOUND,
    };
  }
  return null;
}

/** Soft-delete movimentações elegíveis (RASCUNHO, PENDENTE_REVISAO, REJEITADO). */
export async function softDeleteMovimentacoes(
  db: Db,
  ids: string[],
): Promise<SoftDeleteMovimentacoesResult> {
  const skipped: SoftDeleteMovimentacaoSkipped[] = [];
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

  const rows = await db.query.movimentacao.findMany({
    where: inArray(movimentacao.id, uniqueIds),
    columns: { id: true, status: true, deletedAt: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const id of uniqueIds) {
    const mov = byId.get(id);
    if (!mov) {
      skipped.push({
        id,
        reason: "Movimentação não encontrada",
        code: MOVIMENTACAO_DELETE_CODES.NOT_FOUND,
      });
      continue;
    }

    const block = skipReason(mov.status, mov.deletedAt);
    if (block) {
      skipped.push({ ...block, id });
      continue;
    }

    await db
      .update(movimentacao)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(movimentacao.id, id));
    deleted += 1;
  }

  return { deleted, skipped };
}
