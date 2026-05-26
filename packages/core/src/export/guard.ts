/** Export guard — block export when pendencies exist for a prestador/exercicio. */

import { and, eq, notInArray, or } from "drizzle-orm";

import { diretorioEstadual, movimentacao, type Db } from "@spc-up/db";

import { scopePrestadorExercicio } from "./scope";

const EXPORTABLE_STATUSES = ["CONFIRMADO", "EXPORTADO"] as const;

function blockingWhere(cnpjPrestador: string, exercicio: number) {
  return and(
    scopePrestadorExercicio(cnpjPrestador, exercicio),
    or(
      notInArray(movimentacao.status, [...EXPORTABLE_STATUSES]),
      eq(movimentacao.bloqueioExport, true),
    ),
  );
}

/** Return true when every movimentacao for the prestador scope is export-ready. */
export async function canExportByPrestador(
  db: Db,
  cnpjPrestador: string,
  exercicio: number,
): Promise<boolean> {
  const blocking = await db
    .select({ id: movimentacao.id })
    .from(movimentacao)
    .where(blockingWhere(cnpjPrestador, exercicio))
    .limit(1);

  return blocking.length === 0;
}

/** Legacy: export readiness for the estadual prestador of a UF. */
export async function canExport(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<boolean> {
  const rows = await db
    .select({ cnpj: diretorioEstadual.cnpjPrestador })
    .from(diretorioEstadual)
    .where(eq(diretorioEstadual.uf, uf.toUpperCase()))
    .limit(1);
  const cnpj = rows[0]?.cnpj;
  if (!cnpj) {
    return false;
  }
  return canExportByPrestador(db, cnpj, exercicio);
}
