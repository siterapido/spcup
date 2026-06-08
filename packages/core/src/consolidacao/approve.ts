import {
  consolidacaoEvento,
  consolidacaoLinha,
  CONSOLIDACAO_EVENTO_STATUS,
  matchEvidencia,
  movimentacao,
  type Db,
} from "@spc-up/db";
import { eq } from "drizzle-orm";

import { rematchPendingMovimentacoes } from "../cadastro/rematch";
import { MOVIMENTACAO_STATUS } from "../ingest/types";
import { applyDeterministicMatch } from "../match/rules";
import { getSessao } from "../prestacao/sessao";
import type { OrigemAtributosEvento, OrigemEnriquecimentoV1, OrigemRef } from "../provenance/types";
async function pickCanonicaMovimentacaoId(
  db: Db,
  eventoId: string,
): Promise<string> {
  const linhas = await db
    .select({
      movimentacaoId: consolidacaoLinha.movimentacaoId,
      papel: consolidacaoLinha.papel,
    })
    .from(consolidacaoLinha)
    .innerJoin(movimentacao, eq(consolidacaoLinha.movimentacaoId, movimentacao.id))
    .where(eq(consolidacaoLinha.eventoId, eventoId));

  const completo = linhas.find((l) => l.papel === "COMPLETO");
  if (completo) {
    return completo.movimentacaoId;
  }
  const pix = linhas.find((l) => l.papel === "PIX");
  if (pix) {
    return pix.movimentacaoId;
  }
  return linhas[0]!.movimentacaoId;
}

function mergeDescricao(parts: string[]): string {
  const unique = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
  return unique.join(" | ");
}

export async function approveConsolidacaoEvento(
  db: Db,
  eventoId: string,
): Promise<void> {
  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, eventoId),
    with: { linhas: { with: { movimentacao: true } } },
  });
  if (!evento) {
    throw new Error("Evento de consolidação não encontrado");
  }
  if (evento.status !== CONSOLIDACAO_EVENTO_STATUS.PENDENTE) {
    throw new Error("Evento já processado");
  }

  const canonicaId = await pickCanonicaMovimentacaoId(db, eventoId);
  const absorbedIds = evento.linhas
    .map((l) => l.movimentacaoId)
    .filter((id) => id !== canonicaId);

  const descricoes = evento.linhas.map((l) => l.movimentacao.descricaoRaw);
  const enrichedDescricao = mergeDescricao(descricoes);

  const canonicaLinha = evento.linhas.find((l) => l.movimentacaoId === canonicaId);
  const origemExtracao = canonicaLinha?.movimentacao.origemExtracao ?? null;
  const origemAtributos = evento.origemAtributos as OrigemAtributosEvento | null;
  const enriquecimentoRefs: OrigemRef[] = origemAtributos
    ? [
        ...origemAtributos.pessoa.filter((r) => r.tipo !== "PDF"),
        ...origemAtributos.confianca,
      ]
    : [];
  const origemEnriquecimento: OrigemEnriquecimentoV1 | null =
    enriquecimentoRefs.length > 0 ? { versao: 1, refs: enriquecimentoRefs } : null;

  await db
    .update(movimentacao)
    .set({
      descricaoRaw: enrichedDescricao,
      pessoaFisicaId: evento.pessoaFisicaId,
      pessoaJuridicaId: evento.pessoaJuridicaId,
      remetenteDestinatario: evento.remetenteDestinatario,
      confiancaGlobal: evento.confianca,
      origemExtracao,
      origemEnriquecimento,
    })
    .where(eq(movimentacao.id, canonicaId));

  for (const absorbedId of absorbedIds) {
    await db
      .update(movimentacao)
      .set({
        movimentacaoCanonicaId: canonicaId,
        status: MOVIMENTACAO_STATUS.REJEITADO,
      })
      .where(eq(movimentacao.id, absorbedId));
  }

  await applyDeterministicMatch(db, canonicaId);

  await db.insert(matchEvidencia).values({
    movimentacaoId: canonicaId,
    tipo: "CRUZAMENTO_PDF",
    peso: evento.confianca,
    detalhe: evento.justificativa ?? "Consolidação aprovada",
  });

  await db
    .update(consolidacaoEvento)
    .set({
      status: CONSOLIDACAO_EVENTO_STATUS.APROVADO,
      movimentacaoCanonicaId: canonicaId,
    })
    .where(eq(consolidacaoEvento.id, eventoId));

  const sessao = await getSessao(db, evento.sessaoPrestacaoId);
  if (sessao) {
    await rematchPendingMovimentacoes(db, sessao.uf, sessao.exercicio);
  }
}

export async function rejectConsolidacaoEvento(
  db: Db,
  eventoId: string,
): Promise<void> {
  await db
    .update(consolidacaoEvento)
    .set({ status: CONSOLIDACAO_EVENTO_STATUS.REJEITADO })
    .where(eq(consolidacaoEvento.id, eventoId));
}
