/** Confirm movimentacoes for export. */

import { eq, inArray } from "drizzle-orm";

import { movimentacao, type Db } from "@spc-up/db";

import { evaluateMovimentacao } from "./confidence";

export interface ConfirmResult {
  confirmed: number;
  total: number;
  notFound: string[];
  blocked: string[];
}

/** Set status CONFIRMADO after re-evaluating confidence. */
export async function confirmMovimentacoes(
  db: Db,
  ids: string[],
): Promise<ConfirmResult> {
  if (ids.length === 0) {
    throw new Error("Informe ao menos um UUID em --ids.");
  }

  const rows = await db.query.movimentacao.findMany({
    where: inArray(movimentacao.id, ids),
    with: { spca: true, evidencias: true },
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  const notFound: string[] = [];
  const blocked: string[] = [];
  let confirmed = 0;

  for (const id of ids) {
    const mov = byId.get(id);
    if (mov == null) {
      notFound.push(id);
      continue;
    }

    const like = {
      confianca_global: mov.confiancaGlobal,
      bloqueio_export: mov.bloqueioExport,
      spca: mov.spca
        ? {
            fonte_recurso: mov.spca.fonteRecurso,
            natureza_recurso: mov.spca.naturezaRecurso,
            tipo_origem_recurso: mov.spca.tipoOrigemRecurso,
          }
        : null,
      evidencias: mov.evidencias.map((ev) => ({
        tipo: ev.tipo,
        peso: ev.peso,
      })),
    };

    evaluateMovimentacao(like);

    if (like.bloqueio_export) {
      blocked.push(id);
      continue;
    }

    await db
      .update(movimentacao)
      .set({
        status: "CONFIRMADO",
        confiancaGlobal: like.confianca_global,
        bloqueioExport: like.bloqueio_export,
        updatedAt: new Date(),
      })
      .where(eq(movimentacao.id, id));

    confirmed += 1;
  }

  return { confirmed, total: ids.length, notFound, blocked };
}
