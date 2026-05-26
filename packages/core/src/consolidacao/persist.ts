import {
  consolidacaoEvento,
  consolidacaoHipotese,
  consolidacaoLinha,
  CONSOLIDACAO_EVENTO_STATUS,
  type Db,
} from "@spc-up/db";
import { and, eq } from "drizzle-orm";

import type { ConsolidacaoEventDraft } from "./types";

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
