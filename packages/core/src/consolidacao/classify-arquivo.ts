import type { ExtratoModeloId } from "../ingest/extrato-modelo";
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

export function resolveLinhaPapel(
  mov: {
    arquivoIngestaoId: string;
    nomeArquivo: string;
    extratoModeloId?: ExtratoModeloId | null;
  },
  arquivoBaseIngestaoId: string,
): ConsolidacaoLinhaPapel {
  if (mov.arquivoIngestaoId === arquivoBaseIngestaoId) {
    return "COMPLETO";
  }
  if (mov.extratoModeloId === "caixa_pix") {
    return "PIX";
  }
  return classifyArquivoPapel(mov.nomeArquivo);
}
