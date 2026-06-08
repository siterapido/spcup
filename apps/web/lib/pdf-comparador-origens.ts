import type { PlanilhaOrigem } from "@spc-up/core";

export function selecionarOrigensPixCompleto(origens: PlanilhaOrigem[]): {
  pix: PlanilhaOrigem | null;
  completo: PlanilhaOrigem | null;
} {
  const pix = origens.find((o) => o.papel === "PIX") ?? null;
  const completo = origens.find((o) => o.papel === "COMPLETO") ?? null;
  return { pix, completo };
}
