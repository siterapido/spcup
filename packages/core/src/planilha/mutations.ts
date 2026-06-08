import { consolidacaoEvento, movimentacao, type Db } from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";

import {
  approveConsolidacaoEvento,
  rejectConsolidacaoEvento,
} from "../consolidacao/approve";
import { assignPessoaToMovimentacao } from "../prestacao/movimentacao-review";
import type { PlanilhaLinhaFonte } from "./types";

export async function planilhaLinhaBelongsToSessao(
  db: Db,
  sessaoId: string,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
): Promise<boolean> {
  if (fonte === "movimentacao") {
    const row = await db.query.movimentacao.findFirst({
      where: and(eq(movimentacao.id, linhaId), isNull(movimentacao.deletedAt)),
      columns: { sessaoPrestacaoId: true },
    });
    return row?.sessaoPrestacaoId === sessaoId;
  }

  const row = await db.query.consolidacaoEvento.findFirst({
    where: and(
      eq(consolidacaoEvento.id, linhaId),
      isNull(consolidacaoEvento.deletedAt),
    ),
    columns: { sessaoPrestacaoId: true },
  });
  return row?.sessaoPrestacaoId === sessaoId;
}

export async function updatePlanilhaLinhaPessoa(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
  body: {
    pessoaFisicaId?: string;
    pessoaJuridicaId?: string;
    limparPessoa?: true;
  },
): Promise<void> {
  if (fonte === "movimentacao") {
    await assignPessoaToMovimentacao(db, linhaId, body);
    return;
  }

  await db
    .update(consolidacaoEvento)
    .set({
      pessoaFisicaId: body.limparPessoa ? null : (body.pessoaFisicaId ?? null),
      pessoaJuridicaId: body.limparPessoa ? null : (body.pessoaJuridicaId ?? null),
      confianca:
        body.pessoaFisicaId || body.pessoaJuridicaId ? 0.95 : undefined,
      justificativa:
        body.pessoaFisicaId || body.pessoaJuridicaId
          ? "Vínculo manual na planilha"
          : undefined,
    })
    .where(eq(consolidacaoEvento.id, linhaId));
}

export async function applyPlanilhaLote(
  db: Db,
  items: Array<{ id: string; fonte: PlanilhaLinhaFonte }>,
  pessoa: { pessoaFisicaId?: string; pessoaJuridicaId?: string },
): Promise<void> {
  for (const item of items) {
    await updatePlanilhaLinhaPessoa(db, item.id, item.fonte, pessoa);
  }
}

export async function resolvePlanilhaMerge(
  db: Db,
  eventoId: string,
  acao: "confirmar" | "separar",
  deps: {
    approveConsolidacaoEvento?: typeof approveConsolidacaoEvento;
    rejectConsolidacaoEvento?: typeof rejectConsolidacaoEvento;
  } = {},
): Promise<void> {
  const approve = deps.approveConsolidacaoEvento ?? approveConsolidacaoEvento;
  const reject = deps.rejectConsolidacaoEvento ?? rejectConsolidacaoEvento;

  if (acao === "confirmar") {
    await approve(db, eventoId);
    return;
  }

  await reject(db, eventoId);
}
