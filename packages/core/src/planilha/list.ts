import {
  CONSOLIDACAO_EVENTO_STATUS,
  movimentacao,
  type Db,
} from "@spc-up/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { loadCadastroMatchContext } from "../consolidacao/load";
import type { ConsolidacaoListItem } from "../consolidacao/queries";
import { listConsolidacaoForSessao } from "../consolidacao/queries";
import { getSessao } from "../prestacao/sessao";
import type { OrigemExtracaoV1 } from "../provenance/types";
import { cleanDescricao } from "./descricao";
import { buildResumo, deriveLinhaStatus } from "./status";
import type {
  PlanilhaLinha,
  PlanilhaOrigem,
  PlanilhaPayload,
  PlanilhaPessoa,
} from "./types";

const EXTRACAO_DUVIDOSA_CONFIANCA = 0.4;

export type ConsolidacaoEventoLinhaInput = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  pessoaFisicaId?: string | null;
  pessoaJuridicaId?: string | null;
  pessoa: {
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
  } | null;
  linhas: Array<{
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nomeArquivo: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
  }>;
};

export type MovimentacaoLinhaInput = {
  id: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricaoRaw: string;
  confiancaGlobal: number;
  pessoaFisica: { id: string; nome: string; cpf: string } | null;
  pessoaJuridica: { id: string; razaoSocial: string; cnpj: string } | null;
  nomeArquivo: string | null;
  arquivoIngestaoId?: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  statusPaginaVerificar?: boolean;
};

function mapPessoaFromConsolidacao(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaPessoa | null {
  if (!evento.pessoa) return null;
  const id = evento.pessoaFisicaId ?? evento.pessoaJuridicaId;
  if (!id) return null;
  return { id, ...evento.pessoa };
}

function mapPessoaFromMovimentacao(mov: MovimentacaoLinhaInput): PlanilhaPessoa | null {
  if (mov.pessoaFisica) {
    return {
      id: mov.pessoaFisica.id,
      tipo: "PF",
      nome: mov.pessoaFisica.nome,
      documento: mov.pessoaFisica.cpf,
    };
  }
  if (mov.pessoaJuridica) {
    return {
      id: mov.pessoaJuridica.id,
      tipo: "PJ",
      nome: mov.pessoaJuridica.razaoSocial,
      documento: mov.pessoaJuridica.cnpj,
    };
  }
  return null;
}

function origensFromLinhas(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
): PlanilhaOrigem[] {
  return linhas.map((l) => ({
    movimentacaoId: l.movimentacaoId,
    arquivoIngestaoId: l.origemExtracao?.arquivoIngestaoId,
    nomeArquivo: l.nomeArquivo,
    pagina: l.origemExtracao?.pagina,
    descricaoRaw: l.descricaoRaw,
    papel: l.papel,
  }));
}

function descricaoFromLinhas(linhas: ConsolidacaoEventoLinhaInput["linhas"]): string {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return cleanDescricao(primary?.descricaoRaw ?? "");
}

function isExtracaoDuvidosaConsolidacao(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
  confianca: number,
): boolean {
  return linhas.some((l) => !l.origemExtracao && confianca < EXTRACAO_DUVIDOSA_CONFIANCA);
}

function isExtracaoDuvidosaMovimentacao(mov: MovimentacaoLinhaInput): boolean {
  if (mov.statusPaginaVerificar) return true;
  return !mov.origemExtracao && mov.confiancaGlobal < EXTRACAO_DUVIDOSA_CONFIANCA;
}

export function mapConsolidacaoEventoToLinha(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaLinha {
  const origens = origensFromLinhas(evento.linhas);
  const pessoa = mapPessoaFromConsolidacao(evento);
  const extracaoDuvidosa = isExtracaoDuvidosaConsolidacao(evento.linhas, evento.confianca);

  return {
    id: evento.id,
    fonte: "consolidacao",
    dataMovimento: evento.dataMovimento,
    valor: evento.valor,
    direcao: evento.direcao,
    descricao: descricaoFromLinhas(evento.linhas),
    confianca: evento.confianca,
    status: deriveLinhaStatus({
      eventoStatus: evento.status,
      origemCount: origens.length,
      pessoa,
      confianca: evento.confianca,
      extracaoDuvidosa,
    }),
    pessoa,
    origens,
    eventoStatus: evento.status,
    extracaoDuvidosa,
  };
}

export function mapMovimentacaoToLinha(mov: MovimentacaoLinhaInput): PlanilhaLinha {
  const pessoa = mapPessoaFromMovimentacao(mov);
  const extracaoDuvidosa = isExtracaoDuvidosaMovimentacao(mov);

  return {
    id: mov.id,
    fonte: "movimentacao",
    dataMovimento: mov.dataMovimento,
    valor: mov.valor,
    direcao: mov.direcao,
    descricao: cleanDescricao(mov.descricaoRaw),
    confianca: mov.confiancaGlobal,
    status: deriveLinhaStatus({
      origemCount: 1,
      pessoa,
      confianca: mov.confiancaGlobal,
      extracaoDuvidosa,
    }),
    pessoa,
    origens: [
      {
        movimentacaoId: mov.id,
        arquivoIngestaoId:
          mov.origemExtracao?.arquivoIngestaoId ?? mov.arquivoIngestaoId ?? undefined,
        nomeArquivo: mov.nomeArquivo,
        pagina: mov.origemExtracao?.pagina,
        descricaoRaw: mov.descricaoRaw,
      },
    ],
    extracaoDuvidosa,
  };
}

function movimentacaoIdsInLinhas(linhas: PlanilhaLinha[]): Set<string> {
  const ids = new Set<string>();
  for (const linha of linhas) {
    if (linha.fonte === "movimentacao") {
      ids.add(linha.id);
    }
    for (const origem of linha.origens) {
      ids.add(origem.movimentacaoId);
    }
  }
  return ids;
}

async function loadMovimentacoesForPlanilha(db: Db, sessaoId: string) {
  return db.query.movimentacao.findMany({
    where: and(
      eq(movimentacao.sessaoPrestacaoId, sessaoId),
      isNull(movimentacao.deletedAt),
      isNull(movimentacao.movimentacaoCanonicaId),
    ),
    with: {
      pessoaFisica: true,
      pessoaJuridica: true,
      arquivoIngestao: true,
      evidencias: true,
    },
    orderBy: [asc(movimentacao.dataMovimento), asc(movimentacao.id)],
  });
}

function dbMovToLinhaInput(
  mov: Awaited<ReturnType<typeof loadMovimentacoesForPlanilha>>[number],
): MovimentacaoLinhaInput {
  return {
    id: mov.id,
    dataMovimento: String(mov.dataMovimento),
    valor: String(mov.valor),
    direcao: mov.direcao,
    descricaoRaw: mov.descricaoRaw,
    confiancaGlobal: mov.confiancaGlobal,
    pessoaFisica: mov.pessoaFisica,
    pessoaJuridica: mov.pessoaJuridica,
    nomeArquivo: mov.arquivoIngestao?.nomeArquivo ?? null,
    arquivoIngestaoId: mov.arquivoIngestaoId,
    origemExtracao: (mov.origemExtracao as OrigemExtracaoV1 | null) ?? null,
    statusPaginaVerificar: mov.evidencias.some((e) => e.tipo === "PAGINA_VERIFICAR"),
  };
}

async function loadRejectedMovimentacoes(
  db: Db,
  eventos: ConsolidacaoListItem[],
  existingIds: Set<string>,
): Promise<MovimentacaoLinhaInput[]> {
  const rejectedMovIds = new Set<string>();
  for (const evento of eventos) {
    if (evento.status !== CONSOLIDACAO_EVENTO_STATUS.REJEITADO) continue;
    for (const linha of evento.linhas) {
      if (!existingIds.has(linha.movimentacaoId)) {
        rejectedMovIds.add(linha.movimentacaoId);
      }
    }
  }
  if (rejectedMovIds.size === 0) return [];

  const rows = await db.query.movimentacao.findMany({
    where: and(
      inArray(movimentacao.id, [...rejectedMovIds]),
      isNull(movimentacao.deletedAt),
      isNull(movimentacao.movimentacaoCanonicaId),
    ),
    with: {
      pessoaFisica: true,
      pessoaJuridica: true,
      arquivoIngestao: true,
      evidencias: true,
    },
  });

  return rows.map(dbMovToLinhaInput);
}

export async function listPlanilhaForSessao(
  db: Db,
  sessaoId: string,
): Promise<PlanilhaPayload | null> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao) return null;

  const { eventos, cadastroAlerta: pixCadastroAlerta } =
    await listConsolidacaoForSessao(db, sessaoId);
  const ctx = await loadCadastroMatchContext(db);
  const cadastroVazio =
    ctx.pessoaByCpf.size === 0 && ctx.pessoaByCnpj.size === 0;
  const cadastroAlerta = cadastroVazio || pixCadastroAlerta;
  const linhas: PlanilhaLinha[] = [];

  if (eventos.length > 0) {
    for (const evento of eventos) {
      if (evento.status === CONSOLIDACAO_EVENTO_STATUS.REJEITADO) continue;
      linhas.push(mapConsolidacaoEventoToLinha(evento));
    }
  } else {
    const movs = await loadMovimentacoesForPlanilha(db, sessaoId);
    for (const mov of movs) {
      linhas.push(mapMovimentacaoToLinha(dbMovToLinhaInput(mov)));
    }
  }

  const existingIds = movimentacaoIdsInLinhas(linhas);
  const rejectedMovs = await loadRejectedMovimentacoes(db, eventos, existingIds);
  for (const mov of rejectedMovs) {
    linhas.push(mapMovimentacaoToLinha(mov));
  }

  return {
    sessao: { id: sessao.id, uf: sessao.uf, exercicio: sessao.exercicio },
    linhas,
    resumo: buildResumo(linhas, cadastroAlerta),
  };
}
