import type { Db } from "@spc-up/db";

import { buildOrigemAtributos } from "../provenance/build-origem-atributos";
import { getSessao } from "../prestacao/sessao";
import { autoAprovarConsolidacaoEventos, applyMesmoValorRevisaoHumanaCap } from "./auto";
import { buildConsolidacaoCandidates } from "./candidates";
import { enrichAmbiguousWithAi } from "./ai";
import {
  countPdfIngestoesForSessao,
  loadCadastroMatchContext,
  loadMovimentacaoCandidates,
} from "./load";
import { deletePendingConsolidacaoEvents, persistConsolidacaoDrafts } from "./persist";
import { getConfiancaLimiarAlta } from "./thresholds";

export type ConsolidateSessionResult =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      eventos: number;
      autoAprovados: number;
      paraRevisar: number;
      limiarAutoAprovacao: number;
      errosAutoAprovacao?: string[];
    };

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

  const movById = new Map(movs.map((m) => [m.id, m]));
  const ctx = await loadCadastroMatchContext(db);
  let drafts = buildConsolidacaoCandidates(movs, ctx);

  if (process.env.OPENROUTER_API_KEY) {
    drafts = await enrichAmbiguousWithAi(db, drafts, movs, {
      uf: sessao.uf,
      exercicio: sessao.exercicio,
    });
  }

  applyMesmoValorRevisaoHumanaCap(drafts);
  for (const draft of drafts) {
    draft.origemAtributos = buildOrigemAtributos(draft, movById);
  }

  await deletePendingConsolidacaoEvents(db, sessaoId);
  const ids = await persistConsolidacaoDrafts(db, sessaoId, drafts);

  const { aprovados: autoAprovados, erros } = await autoAprovarConsolidacaoEventos(
    db,
    ids,
    drafts,
  );

  const limiarAutoAprovacao = getConfiancaLimiarAlta();
  return {
    skipped: false,
    eventos: ids.length,
    autoAprovados,
    paraRevisar: ids.length - autoAprovados,
    limiarAutoAprovacao,
    ...(erros.length > 0 ? { errosAutoAprovacao: erros } : {}),
  };
}
