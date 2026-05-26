/** Export guard — block export when pendencies exist for a UF/exercicio. */

import { and, eq, notInArray, or } from "drizzle-orm";

import { movimentacao, type Db } from "@spc-up/db";

const EXPORTABLE_STATUSES = ["CONFIRMADO", "EXPORTADO"] as const;

/** Return true when every movimentacao for the scope is export-ready. */
export async function canExport(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<boolean> {
  const blocking = await db
    .select({ id: movimentacao.id })
    .from(movimentacao)
    .where(
      and(
        eq(movimentacao.uf, uf),
        eq(movimentacao.exercicio, exercicio),
        or(
          notInArray(movimentacao.status, [...EXPORTABLE_STATUSES]),
          eq(movimentacao.bloqueioExport, true),
        ),
      ),
    )
    .limit(1);

  return blocking.length === 0;
}
