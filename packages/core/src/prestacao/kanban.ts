import { movimentacao, sessaoPrestacao, type Db } from "@spc-up/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { REQUIRED_SPCA_FIELDS } from "../confidence";
import type { OrigemEnriquecimentoV1, OrigemExtracaoV1 } from "../provenance/types";
import { getSessao, prestadorFromSessao } from "./sessao";

export interface KanbanCard {
  id: string;
  valor: string;
  dataMovimento: string;
  direcao: string;
  status: string;
  confiancaGlobal: number;
  bloqueioExport: boolean;
  descricaoRaw: string;
  credDev: string | null;
  lacunas: string[];
  justificativaIa: string | null;
  iaIndisponivel: boolean;
  pessoaResumo: string | null;
  arquivoIngestaoId: string | null;
  nomeArquivo: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  origemEnriquecimento: OrigemEnriquecimentoV1 | null;
}

export interface KanbanArquivoGroup {
  id: string;
  nomeArquivo: string;
  status: string;
  movimentacoes: KanbanCard[];
}

export interface KanbanPayload {
  sessao: {
    id: string;
    uf: string;
    tipoPrestador: string;
    exercicio: number;
    status: string;
    cnpjPrestador: string;
    prestadorNome: string;
  };
  exportavel: boolean;
  arquivos: KanbanArquivoGroup[];
}

function lacunasFromEvidencias(
  evidencias: Array<{ tipo: string; detalhe: string | null }>,
): string[] {
  return evidencias
    .filter((e) => e.tipo === "LACUNA_XSD")
    .map((e) => e.detalhe ?? "")
    .filter(Boolean);
}

export async function getKanbanPayload(
  db: Db,
  sessaoId: string,
  exportavelFn: (db: Db, cnpj: string, exercicio: number) => Promise<boolean>,
): Promise<KanbanPayload | null> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao) {
    return null;
  }

  const prestador = prestadorFromSessao(sessao);
  const prestadorNome =
    sessao.diretorioMunicipal?.nomeMunicipio ??
    sessao.diretorioEstadual?.nome ??
    prestador.cnpjPrestador;

  const movs = await db.query.movimentacao.findMany({
    where: and(
      eq(movimentacao.sessaoPrestacaoId, sessaoId),
      isNull(movimentacao.deletedAt),
    ),
    with: {
      pessoaFisica: true,
      pessoaJuridica: true,
      arquivoIngestao: true,
      evidencias: true,
    },
    orderBy: [asc(movimentacao.dataMovimento), asc(movimentacao.id)],
  });

  const exportavel = await exportavelFn(
    db,
    prestador.cnpjPrestador,
    sessao.exercicio,
  );

  const byArquivo = new Map<string, KanbanArquivoGroup>();

  for (const mov of movs) {
    const arquivoId = mov.arquivoIngestaoId ?? "sem-arquivo";
    if (!byArquivo.has(arquivoId)) {
      byArquivo.set(arquivoId, {
        id: arquivoId,
        nomeArquivo: mov.arquivoIngestao?.nomeArquivo ?? "Sem arquivo",
        status: mov.arquivoIngestao?.status ?? "—",
        movimentacoes: [],
      });
    }

    const justificativa = mov.evidencias.find((e) => e.tipo === "IA_JUSTIFICATIVA");
    const iaIndisponivel = mov.evidencias.some((e) => e.tipo === "IA_INDISPONIVEL");
    let lacunas = lacunasFromEvidencias(mov.evidencias);
    if (lacunas.length === 0 && mov.bloqueioExport) {
      lacunas = [...REQUIRED_SPCA_FIELDS];
    }

    const pessoaResumo = mov.pessoaFisica
      ? `${mov.pessoaFisica.nome} (CPF …${mov.pessoaFisica.cpf.slice(-4)})`
      : mov.pessoaJuridica
        ? `${mov.pessoaJuridica.razaoSocial} (CNPJ …${mov.pessoaJuridica.cnpj.slice(-4)})`
        : null;

    byArquivo.get(arquivoId)!.movimentacoes.push({
      id: mov.id,
      valor: mov.valor,
      dataMovimento: String(mov.dataMovimento),
      direcao: mov.direcao,
      status: mov.status,
      confiancaGlobal: mov.confiancaGlobal,
      bloqueioExport: mov.bloqueioExport,
      descricaoRaw: mov.descricaoRaw,
      credDev: mov.credDev,
      lacunas,
      justificativaIa: justificativa?.detalhe ?? null,
      iaIndisponivel,
      pessoaResumo,
      arquivoIngestaoId: mov.arquivoIngestaoId,
      nomeArquivo: mov.arquivoIngestao?.nomeArquivo ?? null,
      origemExtracao: (mov.origemExtracao as OrigemExtracaoV1 | null) ?? null,
      origemEnriquecimento:
        (mov.origemEnriquecimento as OrigemEnriquecimentoV1 | null) ?? null,
    });
  }

  return {
    sessao: {
      id: sessao.id,
      uf: sessao.uf,
      tipoPrestador: sessao.tipoPrestador,
      exercicio: sessao.exercicio,
      status: sessao.status,
      cnpjPrestador: prestador.cnpjPrestador,
      prestadorNome,
    },
    exportavel,
    arquivos: [...byArquivo.values()],
  };
}

export type ListSessoesFilters = {
  limit?: number;
  uf?: string;
  exercicio?: number;
};

export async function listRecentSessoes(db: Db, filters: ListSessoesFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 10, 1), 100);
  const conditions = [];
  if (filters.uf) {
    conditions.push(eq(sessaoPrestacao.uf, filters.uf.toUpperCase()));
  }
  if (filters.exercicio != null) {
    conditions.push(eq(sessaoPrestacao.exercicio, filters.exercicio));
  }
  conditions.push(isNull(sessaoPrestacao.deletedAt));

  return db.query.sessaoPrestacao.findMany({
    limit,
    orderBy: [desc(sessaoPrestacao.createdAt)],
    where: and(...conditions),
    with: {
      diretorioEstadual: true,
      diretorioMunicipal: true,
    },
  });
}

export {
  formatPeriodoPrestacao,
  getPeriodoPrestacao,
  getPeriodosPrestacaoBatch,
  type PeriodoPrestacao,
} from "./periodo";
