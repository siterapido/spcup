/** Confidence scoring and export blocking for movimentacao matches. */

export const DEFAULT_WEIGHTS: Record<string, number> = {
  CPF_EXATO: 0.45,
  VALOR_DATA: 0.25,
  NOME_ALTO: 0.2,
  NOME_FUZZY: 0.1,
  IA: 0.15,
};

export const DEFAULT_CONFLICT_CAP = 0.4;

/** Stub list — expand per direction/module when export builders land. */
export const REQUIRED_SPCA_FIELDS = [
  "fonte_recurso",
  "natureza_recurso",
  "tipo_origem_recurso",
] as const;

export interface Evidence {
  tipo: string;
  peso?: number | null;
  cap?: number | null;
}

export interface MovimentacaoSpcaLike {
  fonte_recurso?: string | null;
  natureza_recurso?: string | null;
  tipo_origem_recurso?: string | null;
}

export interface MovimentacaoEvidenceLike {
  tipo: string;
  peso?: number | null;
}

export interface MovimentacaoLike {
  confianca_global: number;
  bloqueio_export: boolean;
  spca?: MovimentacaoSpcaLike | null;
  evidencias?: MovimentacaoEvidenceLike[];
}

function isConflict(evidence: Evidence): boolean {
  return evidence.tipo.startsWith("CONFLITO");
}

function evidenceWeight(evidence: Evidence): number {
  if (evidence.peso != null) {
    return evidence.peso;
  }
  return DEFAULT_WEIGHTS[evidence.tipo] ?? 0;
}

/** Sum evidence weights and apply the tightest conflict cap when present. */
export function computeConfidence(evidences: readonly Evidence[]): number {
  let score = 0;
  let conflictCap: number | null = null;

  for (const evidence of evidences) {
    if (isConflict(evidence)) {
      const cap = evidence.cap ?? DEFAULT_CONFLICT_CAP;
      conflictCap = conflictCap == null ? cap : Math.min(conflictCap, cap);
      continue;
    }
    score += evidenceWeight(evidence);
  }

  score = Math.min(score, 1);
  if (conflictCap != null) {
    score = Math.min(score, conflictCap);
  }
  return score;
}

function evidencesFromMovimentacao(movimentacao: MovimentacaoLike): Evidence[] {
  return (movimentacao.evidencias ?? []).map((ev) => ({
    tipo: ev.tipo,
    peso: ev.peso,
  }));
}

function missingRequiredSpcaFields(movimentacao: MovimentacaoLike): boolean {
  const spca = movimentacao.spca;
  if (spca == null) {
    return true;
  }

  for (const field of REQUIRED_SPCA_FIELDS) {
    const value = spca[field];
    if (value == null || value === "") {
      return true;
    }
  }
  return false;
}

/** Update confianca_global and bloqueio_export on the movimentacao. */
export function evaluateMovimentacao(
  movimentacao: MovimentacaoLike,
  evidences?: readonly Evidence[],
): number {
  const resolved =
    evidences != null ? [...evidences] : evidencesFromMovimentacao(movimentacao);
  const score = computeConfidence(resolved);

  movimentacao.confianca_global = score;
  movimentacao.bloqueio_export = missingRequiredSpcaFields(movimentacao);
  return score;
}
