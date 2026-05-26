import type { ConsolidacaoLinhaPapel } from "./types";

/** Classify bank extract file role from filename heuristics (PIX vs full statement). */
export function classifyArquivoPapel(nomeArquivo: string): ConsolidacaoLinhaPapel {
  if (/pix/i.test(nomeArquivo)) {
    return "PIX";
  }
  if (/total|completo/i.test(nomeArquivo)) {
    return "COMPLETO";
  }
  return "OUTRO";
}
