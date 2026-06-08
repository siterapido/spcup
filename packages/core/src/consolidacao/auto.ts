import type { Db } from "@spc-up/db";

import { approveConsolidacaoEvento } from "./approve";
import type { ConsolidacaoEventDraft } from "./types";
import { getConfiancaLimiarAlta } from "./thresholds";

const CAP_MESMO_VALOR = 0.64;
const CONFIANCA_CPF_FORTE = 0.9;

export function hasPessoaVinculo(draft: ConsolidacaoEventDraft): boolean {
  return Boolean(draft.pessoaFisicaId || draft.pessoaJuridicaId);
}

export function eventoDraftKey(draft: ConsolidacaoEventDraft): string {
  return `${draft.dataMovimento}|${draft.valor}|${draft.direcao.toUpperCase()}`;
}

/**
 * Várias movimentações com mesmo valor/data sem CPF forte → força revisão humana.
 */
export function applyMesmoValorRevisaoHumanaCap(drafts: ConsolidacaoEventDraft[]): void {
  const byKey = new Map<string, ConsolidacaoEventDraft[]>();
  for (const draft of drafts) {
    const key = eventoDraftKey(draft);
    const group = byKey.get(key) ?? [];
    group.push(draft);
    byKey.set(key, group);
  }

  for (const group of byKey.values()) {
    if (group.length <= 1) {
      continue;
    }

    for (const draft of group) {
      const cpfForte = hasPessoaVinculo(draft) && draft.confianca >= CONFIANCA_CPF_FORTE;
      if (cpfForte) {
        continue;
      }
      draft.confianca = Math.min(draft.confianca, CAP_MESMO_VALOR);
      const aviso = `${group.length} movimentações com mesmo valor e data`;
      if (!draft.justificativa.includes(aviso)) {
        draft.justificativa = `${aviso}; revisão humana. ${draft.justificativa}`;
      }
    }
  }
}

/** Match automático: cadastro vinculado + confiança no limiar alto. */
export function isConsolidacaoAutoAprovavel(
  draft: ConsolidacaoEventDraft,
  limiarAlta = getConfiancaLimiarAlta(),
): boolean {
  return (
    hasPessoaVinculo(draft) &&
    draft.confianca >= limiarAlta &&
    draft.cadastroLinkTier === "ALTA"
  );
}

export async function autoAprovarConsolidacaoEventos(
  db: Db,
  eventoIds: string[],
  drafts: ConsolidacaoEventDraft[],
): Promise<{ aprovados: number; erros: string[] }> {
  const erros: string[] = [];
  let aprovados = 0;

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const eventoId = eventoIds[i];
    if (!draft || !eventoId || !isConsolidacaoAutoAprovavel(draft)) {
      continue;
    }
    try {
      await approveConsolidacaoEvento(db, eventoId);
      aprovados += 1;
    } catch (err) {
      erros.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { aprovados, erros };
}
