import {
  diretorioEstadual,
  diretorioMunicipal,
  movimentacao,
  type Db,
} from "@spc-up/db";
import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  inArray,
  isNull,
} from "drizzle-orm";

import { isValidUf } from "../prestacao/constants";
import { parseMesFilter } from "./parse-mes";
import type {
  MovimentacaoAprovadaItem,
  MovimentacaoAprovadaStatus,
  MovimentacoesAprovadasExportFilters,
  MovimentacoesAprovadasFilters,
  MovimentacoesAprovadasPayload,
  MovimentacoesAprovadasPrestador,
  MovimentacoesAprovadasResumo,
} from "./types";

export const APPROVED_STATUSES = ["CONFIRMADO", "EXPORTADO"] as const;
export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;
export const MAX_EXPORT_ROWS = 50_000;

type MovRow = Awaited<ReturnType<typeof fetchMovimentacaoRows>>[number];

function maskCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

function maskCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return cnpj;
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
}

export function maskPessoaDocumento(
  pessoaFisica: { cpf: string } | null | undefined,
  pessoaJuridica: { cnpj: string } | null | undefined,
): string | null {
  if (pessoaFisica?.cpf) return maskCpf(pessoaFisica.cpf);
  if (pessoaJuridica?.cnpj) return maskCnpj(pessoaJuridica.cnpj);
  return null;
}

export function resolvePrestadorNome(
  cnpj: string,
  estadualByCnpj: Map<string, string>,
  municipalByCnpj: Map<string, string>,
): string | null {
  return estadualByCnpj.get(cnpj) ?? municipalByCnpj.get(cnpj) ?? null;
}

export function mapMovimentacaoToAprovadaItem(
  row: MovRow,
  prestadorNome: string | null,
): MovimentacaoAprovadaItem {
  return {
    id: row.id,
    uf: row.uf,
    exercicio: row.exercicio,
    data_movimento: String(row.dataMovimento),
    valor: String(row.valor),
    direcao: row.direcao,
    descricao_raw: row.descricaoRaw,
    cred_dev: row.credDev,
    status: row.status as MovimentacaoAprovadaStatus,
    confianca_global: row.confiancaGlobal,
    pessoa_nome:
      row.pessoaFisica?.nome ?? row.pessoaJuridica?.razaoSocial ?? null,
    pessoa_documento: maskPessoaDocumento(row.pessoaFisica, row.pessoaJuridica),
    cnpj_prestador: row.cnpjPrestador,
    prestador_nome: prestadorNome,
    sessao_prestacao_id: row.sessaoPrestacaoId,
    nome_arquivo: row.arquivoIngestao?.nomeArquivo ?? null,
  };
}

function baseWhere(uf: string, exercicio: number, from: string, to: string) {
  return and(
    isNull(movimentacao.deletedAt),
    isNull(movimentacao.movimentacaoCanonicaId),
    inArray(movimentacao.status, [...APPROVED_STATUSES]),
    eq(movimentacao.uf, uf),
    eq(movimentacao.exercicio, exercicio),
    between(movimentacao.dataMovimento, from, to),
  );
}

const orderBy = [
  desc(movimentacao.dataMovimento),
  asc(movimentacao.cnpjPrestador),
  asc(movimentacao.id),
];

async function fetchMovimentacaoRows(
  db: Db,
  where: ReturnType<typeof baseWhere>,
  options?: { limit?: number; offset?: number },
) {
  return db.query.movimentacao.findMany({
    where,
    with: {
      pessoaFisica: true,
      pessoaJuridica: true,
      arquivoIngestao: true,
    },
    orderBy,
    ...(options?.limit != null ? { limit: options.limit } : {}),
    ...(options?.offset != null ? { offset: options.offset } : {}),
  });
}

async function loadPrestadorNomeMaps(
  db: Db,
  cnpjs: string[],
): Promise<{
  estadualByCnpj: Map<string, string>;
  municipalByCnpj: Map<string, string>;
}> {
  const estadualByCnpj = new Map<string, string>();
  const municipalByCnpj = new Map<string, string>();
  if (cnpjs.length === 0) {
    return { estadualByCnpj, municipalByCnpj };
  }

  const [estaduais, municipais] = await Promise.all([
    db
      .select({
        cnpj: diretorioEstadual.cnpjPrestador,
        nome: diretorioEstadual.nome,
      })
      .from(diretorioEstadual)
      .where(inArray(diretorioEstadual.cnpjPrestador, cnpjs)),
    db
      .select({
        cnpj: diretorioMunicipal.cnpjPrestador,
        nome: diretorioMunicipal.nomeMunicipio,
      })
      .from(diretorioMunicipal)
      .where(inArray(diretorioMunicipal.cnpjPrestador, cnpjs)),
  ]);

  for (const row of estaduais) {
    estadualByCnpj.set(row.cnpj, row.nome);
  }
  for (const row of municipais) {
    municipalByCnpj.set(row.cnpj, row.nome);
  }

  return { estadualByCnpj, municipalByCnpj };
}

async function loadDistinctPrestadores(
  db: Db,
  where: ReturnType<typeof baseWhere>,
): Promise<MovimentacoesAprovadasPrestador[]> {
  const rows = await db
    .selectDistinct({ cnpj: movimentacao.cnpjPrestador })
    .from(movimentacao)
    .where(where)
    .orderBy(asc(movimentacao.cnpjPrestador));

  const cnpjs = rows.map((r) => r.cnpj);
  const { estadualByCnpj, municipalByCnpj } = await loadPrestadorNomeMaps(
    db,
    cnpjs,
  );

  return cnpjs.map((cnpj) => ({
    cnpj,
    nome: resolvePrestadorNome(cnpj, estadualByCnpj, municipalByCnpj),
  }));
}

async function loadResumo(
  db: Db,
  where: ReturnType<typeof baseWhere>,
): Promise<MovimentacoesAprovadasResumo> {
  const rows = await db
    .select({
      status: movimentacao.status,
      total: count(),
    })
    .from(movimentacao)
    .where(where)
    .groupBy(movimentacao.status);

  let confirmadas = 0;
  let exportadas = 0;
  for (const row of rows) {
    if (row.status === "CONFIRMADO") confirmadas = Number(row.total);
    if (row.status === "EXPORTADO") exportadas = Number(row.total);
  }
  return { confirmadas, exportadas };
}

function normalizePagination(page?: number, limit?: number) {
  const safePage = page != null && page > 0 ? Math.floor(page) : DEFAULT_PAGE;
  const rawLimit =
    limit != null && limit > 0 ? Math.floor(limit) : DEFAULT_LIMIT;
  const safeLimit = Math.min(rawLimit, MAX_LIMIT);
  return { page: safePage, limit: safeLimit };
}

function assertUf(uf: string): string {
  const normalized = uf.trim().toUpperCase();
  if (!isValidUf(normalized)) {
    throw new Error("uf inválida");
  }
  return normalized;
}

async function mapRowsToItems(
  db: Db,
  rows: MovRow[],
): Promise<MovimentacaoAprovadaItem[]> {
  const cnpjs = [...new Set(rows.map((r) => r.cnpjPrestador))];
  const { estadualByCnpj, municipalByCnpj } = await loadPrestadorNomeMaps(
    db,
    cnpjs,
  );

  return rows.map((row) =>
    mapMovimentacaoToAprovadaItem(
      row,
      resolvePrestadorNome(
        row.cnpjPrestador,
        estadualByCnpj,
        municipalByCnpj,
      ),
    ),
  );
}

export async function listMovimentacoesAprovadas(
  db: Db,
  filters: MovimentacoesAprovadasFilters,
): Promise<MovimentacoesAprovadasPayload> {
  const uf = assertUf(filters.uf);
  const { exercicio, from, to } = parseMesFilter(filters.mes);
  const { page, limit } = normalizePagination(filters.page, filters.limit);
  const where = baseWhere(uf, exercicio, from, to);

  const [totalRow, resumo, prestadores, rows] = await Promise.all([
    db.select({ total: count() }).from(movimentacao).where(where),
    loadResumo(db, where),
    loadDistinctPrestadores(db, where),
    fetchMovimentacaoRows(db, where, {
      limit,
      offset: (page - 1) * limit,
    }),
  ]);

  const total = Number(totalRow[0]?.total ?? 0);
  const total_pages = total === 0 ? 0 : Math.ceil(total / limit);
  const items = await mapRowsToItems(db, rows);

  return {
    uf,
    mes: filters.mes.trim(),
    exercicio,
    page,
    limit,
    total,
    total_pages,
    resumo,
    prestadores,
    items,
  };
}

export async function listAllMovimentacoesAprovadas(
  db: Db,
  filters: MovimentacoesAprovadasExportFilters,
): Promise<MovimentacaoAprovadaItem[]> {
  const uf = assertUf(filters.uf);
  const { exercicio, from, to } = parseMesFilter(filters.mes);
  const where = baseWhere(uf, exercicio, from, to);

  const rows = await fetchMovimentacaoRows(db, where, {
    limit: MAX_EXPORT_ROWS + 1,
  });

  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error(
      `Recorte excede limite de exportação (${MAX_EXPORT_ROWS} linhas)`,
    );
  }

  return mapRowsToItems(db, rows);
}
