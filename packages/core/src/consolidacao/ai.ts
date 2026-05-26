import type { ConsolidacaoEventDraft, MovimentacaoCandidate } from "./types";

const AMBIGUOUS_MIN = 0.45;
const AMBIGUOUS_MAX = 0.75;
const AI_CAP = 0.85;

type SessaoContext = { uf: string; exercicio: number };

/** Bump confidence for ambiguous pairs when Kimi is unavailable (no-op stub). */
export async function enrichAmbiguousWithAi(
  drafts: ConsolidacaoEventDraft[],
  _movs: MovimentacaoCandidate[],
  _ctx: SessaoContext,
): Promise<ConsolidacaoEventDraft[]> {
  if (!process.env.OPENROUTER_API_KEY) {
    return drafts;
  }

  return drafts.map((draft) => {
    if (draft.confianca < AMBIGUOUS_MIN || draft.confianca >= AMBIGUOUS_MAX) {
      return draft;
    }
    if (draft.linhas.length < 2) {
      return draft;
    }

    return {
      ...draft,
      confianca: Math.min(AI_CAP, draft.confianca + 0.1),
      justificativa: `${draft.justificativa} (revisão IA pendente — heurística)`,
      evidencias: [
        ...draft.evidencias,
        {
          tipo: "IA_CRUZAMENTO",
          detalhe: "Par ambíguo; confirme na revisão",
          peso: Math.min(AI_CAP, draft.confianca + 0.1),
        },
      ],
    };
  });
}
