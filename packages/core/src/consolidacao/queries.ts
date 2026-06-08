import {
  consolidacaoEvento,
  CONSOLIDACAO_EVENTO_STATUS,
  type Db,
} from "@spc-up/db";
import { and, desc, eq, isNull } from "drizzle-orm";

import { hasCpfInDescricao } from "../match/rules";
import type { OrigemAtributosEvento, OrigemExtracaoV1 } from "../provenance/types";
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
  remetenteDestinatario: string | null;
  pessoa: {
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
  } | null;
  linhas: Array<{
    id: string;
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nrExtratoBancario: string | null;
    nomeArquivo: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
  }>;
  hipoteses: Array<{
    id: string;
    tipo: string;
    confianca: number;
    payload: unknown;
  }>;
  origemAtributos: OrigemAtributosEvento | null;
  extracaoConfirmada: boolean;
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
    where: and(
      eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
      isNull(consolidacaoEvento.deletedAt),
    ),
    with: {
      linhas: {
        with: {
          movimentacao: { with: { evidencias: true } },
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
      (m) => /pix/i.test(m.nomeArquivo) && !hasCpfInDescricao(m.descricaoRaw),
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
      remetenteDestinatario: e.remetenteDestinatario,
      pessoa: e.pessoaFisica
        ? {
            nome: e.pessoaFisica.nome,
            documento: e.pessoaFisica.cpf,
            tipo: "PF" as const,
          }
        : e.pessoaJuridica
          ? {
              nome: e.pessoaJuridica.razaoSocial,
              documento: e.pessoaJuridica.cnpj,
              tipo: "PJ" as const,
            }
          : null,
      linhas: e.linhas.map((l) => ({
        id: l.id,
        movimentacaoId: l.movimentacaoId,
        papel: l.papel,
        descricaoRaw: l.movimentacao.descricaoRaw,
        nrExtratoBancario: l.movimentacao.nrExtratoBancario,
        nomeArquivo: l.arquivoIngestao?.nomeArquivo ?? null,
        origemExtracao:
          (l.movimentacao.origemExtracao as OrigemExtracaoV1 | null) ?? null,
      })),
      hipoteses: e.hipoteses.map((h) => ({
        id: h.id,
        tipo: h.tipo,
        confianca: h.confianca,
        payload: h.payload,
      })),
      origemAtributos: (e.origemAtributos as OrigemAtributosEvento | null) ?? null,
      extracaoConfirmada: e.linhas.some((l) =>
        l.movimentacao.evidencias.some((ev) => ev.tipo === "EXTRACAO_CONFIRMADA"),
      ),
    })),
  };
}

export async function countPendingConsolidacao(db: Db, sessaoId: string): Promise<number> {
  const rows = await db.query.consolidacaoEvento.findMany({
    where: and(
      eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
      isNull(consolidacaoEvento.deletedAt),
    ),
    columns: { id: true, status: true },
  });
  return rows.filter((r) => r.status === CONSOLIDACAO_EVENTO_STATUS.PENDENTE).length;
}
