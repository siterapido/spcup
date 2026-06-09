import {
  arquivoIngestao,
  consolidacaoEvento,
  consolidacaoLinha,
  doacaoFinanceiraLink,
  matchEvidencia,
  movimentacao,
  movimentacaoSpca,
  sessaoPrestacao,
  type Db,
} from "@spc-up/db";
import { eq, inArray } from "drizzle-orm";

/** Remove fisicamente prestação e dados vinculados (movimentações, consolidação, arquivos). */
export async function purgeSessaoData(db: Db, sessaoId: string): Promise<void> {
  const movRows = await db
    .select({ id: movimentacao.id })
    .from(movimentacao)
    .where(eq(movimentacao.sessaoPrestacaoId, sessaoId));
  const movIds = movRows.map((row) => row.id);

  const eventoRows = await db
    .select({ id: consolidacaoEvento.id })
    .from(consolidacaoEvento)
    .where(eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId));
  const eventoIds = eventoRows.map((row) => row.id);

  if (eventoIds.length > 0) {
    await db
      .delete(consolidacaoLinha)
      .where(inArray(consolidacaoLinha.eventoId, eventoIds));
  }

  if (movIds.length > 0) {
    await db
      .delete(consolidacaoLinha)
      .where(inArray(consolidacaoLinha.movimentacaoId, movIds));
    await db
      .update(consolidacaoEvento)
      .set({ movimentacaoCanonicaId: null })
      .where(inArray(consolidacaoEvento.movimentacaoCanonicaId, movIds));
    await db
      .update(movimentacao)
      .set({ movimentacaoCanonicaId: null })
      .where(inArray(movimentacao.movimentacaoCanonicaId, movIds));
    await db.delete(matchEvidencia).where(inArray(matchEvidencia.movimentacaoId, movIds));
    await db.delete(movimentacaoSpca).where(inArray(movimentacaoSpca.movimentacaoId, movIds));
    await db
      .delete(doacaoFinanceiraLink)
      .where(inArray(doacaoFinanceiraLink.movimentacaoOrigemId, movIds));
    await db.delete(movimentacao).where(inArray(movimentacao.id, movIds));
  }

  if (eventoIds.length > 0) {
    await db
      .delete(consolidacaoEvento)
      .where(inArray(consolidacaoEvento.id, eventoIds));
  }

  await db.delete(arquivoIngestao).where(eq(arquivoIngestao.sessaoPrestacaoId, sessaoId));
  await db.delete(sessaoPrestacao).where(eq(sessaoPrestacao.id, sessaoId));
}
