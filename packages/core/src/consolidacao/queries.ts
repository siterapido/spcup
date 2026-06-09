import {
  consolidacaoEvento,
  CONSOLIDACAO_EVENTO_STATUS,
  type Db,
} from "@spc-up/db";
import { and, desc, eq, isNull } from "drizzle-orm";

import { hasStructuredContraparteDoc } from "../match/structured-contraparte-docs";
import type { OrigemAtributosEvento, OrigemExtracaoV1 } from "../provenance/types";
import { countPdfIngestoesForSessao, loadCadastroMatchContext, loadMovimentacaoCandidates } from "./load";
import { buildConsolidacaoCandidates } from "./candidates";

const MATCH_EVIDENCIA_TIPOS = new Set([
  "CPF_CADASTRO",
  "CNPJ_CADASTRO",
  "CPF_SEM_CADASTRO",
  "CNPJ_SEM_CADASTRO",
  "CONFLITO_DOCUMENTO",
  "CONFLITO_NOME",
  "NOME_DIVERGE_CADASTRO",
]);

function matchEvidenciasFromEvento(evento: {
  linhas: Array<{ movimentacao: { evidencias: Array<{ tipo: string }> } }>;
  origemAtributos: unknown;
}): Array<{ tipo: string }> {
  const byTipo = new Map<string, { tipo: string }>();
  for (const linha of evento.linhas) {
    for (const ev of linha.movimentacao.evidencias) {
      if (MATCH_EVIDENCIA_TIPOS.has(ev.tipo)) {
        byTipo.set(ev.tipo, { tipo: ev.tipo });
      }
    }
  }
  if (byTipo.size > 0) return [...byTipo.values()];

  const origem = evento.origemAtributos as OrigemAtributosEvento | null;
  if (!origem) return [];
  const fromOrigem: Array<{ tipo: string }> = [];
  for (const ref of origem.pessoa) {
    if (ref.tipo !== "CADASTRO_UF") continue;
    if (
      ref.matchTipo === "CPF_CADASTRO" ||
      ref.matchTipo === "CNPJ_CADASTRO" ||
      ref.matchTipo === "NOME_CADASTRO"
    ) {
      fromOrigem.push({ tipo: ref.matchTipo });
    }
  }
  return fromOrigem;
}

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
    aliases?: string[] | null;
  } | null;
  matchEvidencias: Array<{ tipo: string }>;
  linhas: Array<{
    id: string;
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nrExtratoBancario: string | null;
    nomeArquivo: string | null;
    arquivoIngestaoId: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
    camposExtracao: Record<string, string | null> | null;
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
      (m) => /pix/i.test(m.nomeArquivo) && !hasStructuredContraparteDoc(m.origemExtracao),
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
            aliases: e.pessoaFisica.aliases,
          }
        : e.pessoaJuridica
          ? {
              nome: e.pessoaJuridica.razaoSocial,
              documento: e.pessoaJuridica.cnpj,
              tipo: "PJ" as const,
              aliases: e.pessoaJuridica.aliases,
            }
          : null,
      matchEvidencias: matchEvidenciasFromEvento(e),
      linhas: e.linhas.map((l) => ({
        id: l.id,
        movimentacaoId: l.movimentacaoId,
        papel: l.papel,
        descricaoRaw: l.movimentacao.descricaoRaw,
        nrExtratoBancario: l.movimentacao.nrExtratoBancario,
        nomeArquivo: l.arquivoIngestao?.nomeArquivo ?? null,
        arquivoIngestaoId:
          l.arquivoIngestaoId ??
          l.arquivoIngestao?.id ??
          l.movimentacao.arquivoIngestaoId ??
          null,
        origemExtracao:
          (l.movimentacao.origemExtracao as OrigemExtracaoV1 | null) ?? null,
        camposExtracao: l.movimentacao.camposExtracao as Record<string, string | null> | null,
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
