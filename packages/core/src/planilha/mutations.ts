import {
  consolidacaoEvento,
  consolidacaoLinha,
  matchEvidencia,
  movimentacao,
  type Db,
} from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";

import { getConfiancaLimiarBaixa } from "../consolidacao/thresholds";

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

const EVIDENCIA_EXTRACAO_CONFIRMADA = "EXTRACAO_CONFIRMADA";

async function confirmarExtracaoMovimentacao(db: Db, movimentacaoId: string): Promise<void> {
  const mov = await db.query.movimentacao.findFirst({
    where: eq(movimentacao.id, movimentacaoId),
    columns: { confiancaGlobal: true },
  });
  if (!mov) {
    throw new Error("Movimentação não encontrada");
  }

  const limiar = getConfiancaLimiarBaixa();
  const confiancaNova = Math.max(mov.confiancaGlobal, limiar);

  await db
    .delete(matchEvidencia)
    .where(
      and(
        eq(matchEvidencia.movimentacaoId, movimentacaoId),
        eq(matchEvidencia.tipo, "PAGINA_VERIFICAR"),
      ),
    );

  const jaConfirmada = await db.query.matchEvidencia.findFirst({
    where: and(
      eq(matchEvidencia.movimentacaoId, movimentacaoId),
      eq(matchEvidencia.tipo, EVIDENCIA_EXTRACAO_CONFIRMADA),
    ),
    columns: { id: true },
  });

  if (!jaConfirmada) {
    await db.insert(matchEvidencia).values({
      movimentacaoId,
      tipo: EVIDENCIA_EXTRACAO_CONFIRMADA,
      peso: 1,
      detalhe: "Extração confirmada na planilha",
    });
  }

  await db
    .update(movimentacao)
    .set({ confiancaGlobal: confiancaNova })
    .where(eq(movimentacao.id, movimentacaoId));
}

export async function confirmarExtracaoPlanilhaLinha(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
): Promise<void> {
  if (fonte === "movimentacao") {
    await confirmarExtracaoMovimentacao(db, linhaId);
    return;
  }

  const linhas = await db
    .select({ movimentacaoId: consolidacaoLinha.movimentacaoId })
    .from(consolidacaoLinha)
    .where(eq(consolidacaoLinha.eventoId, linhaId));

  if (linhas.length === 0) {
    throw new Error("Evento de consolidação não encontrado");
  }

  for (const linha of linhas) {
    await confirmarExtracaoMovimentacao(db, linha.movimentacaoId);
  }

  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, linhaId),
    columns: { confianca: true },
  });
  if (evento) {
    const limiar = getConfiancaLimiarBaixa();
    await db
      .update(consolidacaoEvento)
      .set({ confianca: Math.max(evento.confianca, limiar) })
      .where(eq(consolidacaoEvento.id, linhaId));
  }
}
