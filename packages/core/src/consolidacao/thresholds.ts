/** Limiar de confiança para aprovação automática na consolidação (alinha ao piloto SPC). */
export function getConfiancaLimiarAlta(): number {
  const raw = process.env.CONFIANCA_LIMIAR_ALTA;
  if (raw == null || raw === "") {
    return 0.85;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.85;
}

/** Abaixo deste valor o item é sempre tratado como revisão humana. */
export function getConfiancaLimiarBaixa(): number {
  const raw = process.env.CONFIANCA_LIMIAR_BAIXA;
  if (raw == null || raw === "") {
    return 0.6;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
}
