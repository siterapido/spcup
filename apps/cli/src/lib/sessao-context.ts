import { getSessao, prestadorFromSessao } from "@spc-up/core";
import type { Db } from "@spc-up/db";

export async function requireSessaoContext(db: Db, sessaoId: string) {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadualId || !sessao.diretorioEstadual) {
    throw new Error(`Sessão não encontrada: ${sessaoId}`);
  }
  const prestador = prestadorFromSessao(sessao);
  return { sessao, prestador };
}
