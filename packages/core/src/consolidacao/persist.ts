import {
  consolidacaoEvento,
  consolidacaoHipotese,
  consolidacaoLinha,
  CONSOLIDACAO_EVENTO_STATUS,
  movimentacao,
  type Db,
} from "@spc-up/db";
import { and, eq, inArray } from "drizzle-orm";

import type { ConsolidacaoEventDraft, ConsolidacaoLinhaDraft } from "./types";

function pickRemetenteDestinatarioFromFilhas(
  linhas: ConsolidacaoLinhaDraft[],
  remetenteByMovId: Map<string, string | null>,
): string | null {
  for (const linha of linhas) {
    const remetente = remetenteByMovId.get(linha.movimentacaoId);
    if (remetente != null && remetente.trim().length > 0) {
      return remetente;
    }
  }
  return null;
}

export async function deletePendingConsolidacaoEvents(
  db: Db,
  sessaoId: string,
): Promise<void> {
  await db
    .delete(consolidacaoEvento)
    .where(
      and(
        eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
        eq(consolidacaoEvento.status, CONSOLIDACAO_EVENTO_STATUS.PENDENTE),
      ),
    );
}

export async function persistConsolidacaoDrafts(
  db: Db,
  sessaoId: string,
  drafts: ConsolidacaoEventDraft[],
): Promise<string[]> {
  const ids: string[] = [];
  const movIds = [...new Set(drafts.flatMap((d) => d.linhas.map((l) => l.movimentacaoId)))];
  const remetenteRows =
    movIds.length > 0
      ? await db
          .select({
            id: movimentacao.id,
            remetenteDestinatario: movimentacao.remetenteDestinatario,
          })
          .from(movimentacao)
          .where(inArray(movimentacao.id, movIds))
      : [];
  const remetenteByMovId = new Map(
    remetenteRows.map((r) => [r.id, r.remetenteDestinatario]),
  );

  for (const draft of drafts) {
    const [evento] = await db
      .insert(consolidacaoEvento)
      .values({
        sessaoPrestacaoId: sessaoId,
        status: CONSOLIDACAO_EVENTO_STATUS.PENDENTE,
        dataMovimento: draft.dataMovimento,
        valor: draft.valor,
        direcao: draft.direcao,
        confianca: draft.confianca,
        pessoaFisicaId: draft.pessoaFisicaId,
        pessoaJuridicaId: draft.pessoaJuridicaId,
        justificativa: draft.justificativa,
        origemAtributos: draft.origemAtributos,
        remetenteDestinatario: pickRemetenteDestinatarioFromFilhas(
          draft.linhas,
          remetenteByMovId,
        ),
      })
      .returning({ id: consolidacaoEvento.id });
    if (!evento) {
      continue;
    }
    ids.push(evento.id);

    for (const linha of draft.linhas) {
      await db.insert(consolidacaoLinha).values({
        eventoId: evento.id,
        movimentacaoId: linha.movimentacaoId,
        arquivoIngestaoId: linha.arquivoIngestaoId,
        papel: linha.papel,
      });
    }

    for (const hip of draft.hipoteses) {
      await db.insert(consolidacaoHipotese).values({
        eventoId: evento.id,
        tipo: hip.tipo,
        confianca: hip.confianca,
        payload: hip.payload,
      });
    }
  }
  return ids;
}
