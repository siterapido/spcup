import { movimentacao, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { MOVIMENTACAO_STATUS } from "../ingest/types";

const ALLOWED: Record<string, string[]> = {
  [MOVIMENTACAO_STATUS.RASCUNHO]: [
    MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
    MOVIMENTACAO_STATUS.REJEITADO,
  ],
  [MOVIMENTACAO_STATUS.PENDENTE_REVISAO]: [
    MOVIMENTACAO_STATUS.CONFIRMADO,
    MOVIMENTACAO_STATUS.REJEITADO,
    MOVIMENTACAO_STATUS.RASCUNHO,
  ],
  [MOVIMENTACAO_STATUS.CONFIRMADO]: [
    MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
    MOVIMENTACAO_STATUS.EXPORTADO,
  ],
  [MOVIMENTACAO_STATUS.EXPORTADO]: [],
  [MOVIMENTACAO_STATUS.REJEITADO]: [MOVIMENTACAO_STATUS.RASCUNHO],
};

export async function updateMovimentacaoStatus(
  db: Db,
  movimentacaoId: string,
  newStatus: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db
    .select()
    .from(movimentacao)
    .where(eq(movimentacao.id, movimentacaoId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    return { ok: false, error: "Movimentação não encontrada" };
  }

  const allowed = ALLOWED[current.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      ok: false,
      error: `Transição ${current.status} → ${newStatus} não permitida`,
    };
  }

  if (
    newStatus === MOVIMENTACAO_STATUS.CONFIRMADO &&
    current.bloqueioExport
  ) {
    return { ok: false, error: "Não é possível confirmar: há bloqueio de exportação" };
  }

  await db
    .update(movimentacao)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(movimentacao.id, movimentacaoId));

  return { ok: true };
}
