import type { Db } from "@spc-up/db";

import { getSessao } from "../prestacao/sessao";
import { buildConsolidacaoCandidates } from "./candidates";
import { enrichAmbiguousWithAi } from "./ai";
import {
  countPdfIngestoesForSessao,
  loadCadastroMatchContext,
  loadMovimentacaoCandidates,
} from "./load";
import { deletePendingConsolidacaoEvents, persistConsolidacaoDrafts } from "./persist";

export type ConsolidateSessionResult =
  | { skipped: true; reason: string }
  | { skipped: false; eventos: number };

/** Rebuild pending consolidation events for a session (idempotent for PENDENTE). */
export async function consolidateSession(
  db: Db,
  sessaoId: string,
): Promise<ConsolidateSessionResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao) {
    throw new Error("Sessão não encontrada");
  }
  if (!sessao.consolidarExtratos) {
    return { skipped: true, reason: "FLAG_OFF" };
  }

  const pdfCount = await countPdfIngestoesForSessao(db, sessaoId);
  if (pdfCount < 2) {
    return { skipped: true, reason: "LESS_THAN_TWO_PDF" };
  }

  const movs = await loadMovimentacaoCandidates(db, sessaoId);
  if (movs.length === 0) {
    return { skipped: true, reason: "NO_MOVIMENTACOES" };
  }

  const ctx = await loadCadastroMatchContext(db);
  let drafts = buildConsolidacaoCandidates(movs, ctx);

  if (process.env.OPENROUTER_API_KEY) {
    drafts = await enrichAmbiguousWithAi(drafts, movs, {
      uf: sessao.uf,
      exercicio: sessao.exercicio,
    });
  }

  await deletePendingConsolidacaoEvents(db, sessaoId);
  const ids = await persistConsolidacaoDrafts(db, sessaoId, drafts);

  return { skipped: false, eventos: ids.length };
}
