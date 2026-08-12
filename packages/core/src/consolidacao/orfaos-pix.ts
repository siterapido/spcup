import type { Db } from "@spc-up/db";

import { getSessao } from "../prestacao/sessao";
import { buildConsolidacaoCandidates } from "./candidates";
import { loadCadastroMatchContext, loadMovimentacaoCandidates } from "./load";

export type PixOrfaoItem = {
  movimentacaoId: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  remetenteDestinatario: string | null;
  nomeArquivo: string;
};

export type ListPixOrfaosResult = {
  total: number;
  itens: PixOrfaoItem[];
};

/** PIX lines in session with no matching base row (not shown in main planilha). */
export async function listPixOrfaos(
  db: Db,
  sessaoId: string,
): Promise<ListPixOrfaosResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.arquivoBaseIngestaoId) {
    return { total: 0, itens: [] };
  }

  const movs = await loadMovimentacaoCandidates(db, sessaoId);
  const ctx = await loadCadastroMatchContext(db);
  const { pixOrfaos } = buildConsolidacaoCandidates(movs, ctx, {
    arquivoBaseIngestaoId: sessao.arquivoBaseIngestaoId,
  });

  const itens = pixOrfaos.map((m) => ({
    movimentacaoId: m.id,
    dataMovimento: m.dataMovimento,
    valor: m.valor,
    direcao: m.direcao,
    remetenteDestinatario: m.remetenteDestinatario ?? null,
    nomeArquivo: m.nomeArquivo,
  }));

  return { total: itens.length, itens };
}
