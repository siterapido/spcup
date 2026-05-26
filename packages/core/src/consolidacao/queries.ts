import {
  consolidacaoEvento,
  CONSOLIDACAO_EVENTO_STATUS,
  type Db,
} from "@spc-up/db";
import { desc, eq } from "drizzle-orm";

import { countPdfIngestoesForSessao, loadCadastroMatchContext, loadMovimentacaoCandidates } from "./load";
import { buildConsolidacaoCandidates } from "./candidates";

export type ConsolidacaoListItem = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  linhas: Array<{
    id: string;
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nomeArquivo: string | null;
  }>;
  hipoteses: Array<{
    id: string;
    tipo: string;
    confianca: number;
    payload: unknown;
  }>;
};

export async function listConsolidacaoForSessao(
  db: Db,
  sessaoId: string,
): Promise<{
  eventos: ConsolidacaoListItem[];
  pdfCount: number;
  cadastroAlerta: boolean;
}> {
  const pdfCount = await countPdfIngestoesForSessao(db, sessaoId);

  const eventos = await db.query.consolidacaoEvento.findMany({
    where: eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
    with: {
      linhas: {
        with: {
          movimentacao: true,
          arquivoIngestao: true,
        },
      },
      hipoteses: true,
      pessoaFisica: true,
      pessoaJuridica: true,
    },
    orderBy: [desc(consolidacaoEvento.confianca)],
  });

  let cadastroAlerta = false;
  if (eventos.length === 0 && pdfCount >= 2) {
    const movs = await loadMovimentacaoCandidates(db, sessaoId);
    const ctx = await loadCadastroMatchContext(db);
    const drafts = buildConsolidacaoCandidates(movs, ctx);
    const nomeOnlyPix = movs.some(
      (m) => /pix/i.test(m.nomeArquivo) && !m.descricaoRaw.match(/\d{11}/),
    );
    const anyCadastroMatch = drafts.some((d) => d.confianca >= 0.8);
    cadastroAlerta = nomeOnlyPix && !anyCadastroMatch;
  }

  return {
    pdfCount,
    cadastroAlerta,
    eventos: eventos.map((e) => ({
      id: e.id,
      status: e.status,
      dataMovimento: String(e.dataMovimento),
      valor: String(e.valor),
      direcao: e.direcao,
      confianca: e.confianca,
      justificativa: e.justificativa,
      pessoaFisicaId: e.pessoaFisicaId,
      pessoaJuridicaId: e.pessoaJuridicaId,
      linhas: e.linhas.map((l) => ({
        id: l.id,
        movimentacaoId: l.movimentacaoId,
        papel: l.papel,
        descricaoRaw: l.movimentacao.descricaoRaw,
        nomeArquivo: l.arquivoIngestao?.nomeArquivo ?? null,
      })),
      hipoteses: e.hipoteses.map((h) => ({
        id: h.id,
        tipo: h.tipo,
        confianca: h.confianca,
        payload: h.payload,
      })),
    })),
  };
}

export async function countPendingConsolidacao(db: Db, sessaoId: string): Promise<number> {
  const rows = await db.query.consolidacaoEvento.findMany({
    where: eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
    columns: { id: true, status: true },
  });
  return rows.filter((r) => r.status === CONSOLIDACAO_EVENTO_STATUS.PENDENTE).length;
}
