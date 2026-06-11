import {
  CONSOLIDACAO_EVENTO_STATUS,
  movimentacao,
  arquivoIngestao,
  type Db,
} from "@spc-up/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { loadCadastroMatchContext } from "../consolidacao/load";
import type { ConsolidacaoListItem } from "../consolidacao/queries";
import { listConsolidacaoForSessao } from "../consolidacao/queries";
import { getSessao } from "../prestacao/sessao";
import { compararNomeComPessoa, type CadastroLinkTier } from "../match/cadastro-link";
import type { NomeCadastroComparacao } from "../match/nome-cadastro";
import { isNomeContraparteVazio } from "../match/nome-contraparte";
import type { OrigemExtracaoV1 } from "../provenance/types";
import { cleanDescricao } from "./descricao";
import { buildIngestaoResumo } from "./ingestao-resumo";
import { mapConsolidacaoEventoToLinha } from "./map-consolidacao-linha";
import { buildResumo, deriveLinhaStatus } from "./status";
import type {
  PlanilhaLinha,
  PlanilhaOrigem,
  PlanilhaPayload,
  PlanilhaPessoa,
} from "./types";
import { ExtratoModeloId, detectExtratoModeloFromFilename } from "../ingest/extrato-modelo";
import { colunasFromModelos, colunasFromCamposUnion, PLANILHA_COLUNA_ORDER } from "./colunas-sessao";
import { campoExtracao, type CamposExtracao } from "../ingest/campos-extracao";
import { ordenarLinhasPlanilha } from "./ordenar-linhas";

export type { ConsolidacaoEventoLinhaInput } from "./map-consolidacao-linha";
export { mapConsolidacaoEventoToLinha } from "./map-consolidacao-linha";

const EXTRACAO_DUVIDOSA_CONFIANCA = 0.4;

function deriveCadastroLinkTier(
  evidencias: Array<{ tipo: string }>,
  pessoaLinked: boolean,
  comparacaoNome: NomeCadastroComparacao,
): CadastroLinkTier | null {
  if (
    evidencias.some(
      (e) => e.tipo === "CONFLITO_DOCUMENTO" || e.tipo === "CONFLITO_NOME",
    )
  ) {
    return "REJEITADO";
  }
  if (!pessoaLinked) {
    if (
      evidencias.some(
        (e) => e.tipo === "CPF_SEM_CADASTRO" || e.tipo === "CNPJ_SEM_CADASTRO",
      )
    ) {
      return "BAIXA";
    }
    return null;
  }
  if (
    comparacaoNome === "bate" &&
    evidencias.some((e) => e.tipo === "CPF_CADASTRO" || e.tipo === "CNPJ_CADASTRO")
  ) {
    return "ALTA";
  }
  return "MEDIA";
}

export type MovimentacaoLinhaInput = {
  id: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricaoRaw: string;
  nrExtratoBancario: string | null;
  confiancaGlobal: number;
  pessoaFisica: { id: string; nome: string; cpf: string; aliases?: string[] | null } | null;
  pessoaJuridica: {
    id: string;
    razaoSocial: string;
    cnpj: string;
    aliases?: string[] | null;
  } | null;
  remetenteDestinatario?: string | null;
  nomeArquivo: string | null;
  arquivoIngestaoId?: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  statusPaginaVerificar?: boolean;
  extracaoConfirmada?: boolean;
  evidencias?: Array<{ tipo: string }>;
  camposExtracao?: Record<string, string | null> | null;
};

type MovimentacaoPessoaRef = {
  nome: string;
  aliases?: string[] | null;
};

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

function pessoaRefFromMovimentacao(mov: MovimentacaoLinhaInput): MovimentacaoPessoaRef | null {
  if (mov.pessoaFisica) {
    return { nome: mov.pessoaFisica.nome, aliases: mov.pessoaFisica.aliases };
  }
  if (mov.pessoaJuridica) {
    return { nome: mov.pessoaJuridica.razaoSocial, aliases: mov.pessoaJuridica.aliases };
  }
  return null;
}

function comparacaoNomeFromMov(mov: MovimentacaoLinhaInput): NomeCadastroComparacao | null {
  const pessoaRef = pessoaRefFromMovimentacao(mov);
  if (!pessoaRef || isNomeContraparteVazio(mov.remetenteDestinatario ?? null)) return null;
  return compararNomeComPessoa(mov.remetenteDestinatario!, pessoaRef);
}

function isExtracaoDuvidosaMovimentacao(mov: MovimentacaoLinhaInput): boolean {
  if (mov.extracaoConfirmada) return false;
  if (mov.statusPaginaVerificar) return true;
  return !mov.origemExtracao && mov.confiancaGlobal < EXTRACAO_DUVIDOSA_CONFIANCA;
}

export function mapMovimentacaoToLinha(mov: MovimentacaoLinhaInput): PlanilhaLinha {
  const pessoa = mapPessoaFromMovimentacao(mov);
  const evidencias = mov.evidencias ?? [];
  const comparacaoNome = comparacaoNomeFromMov(mov) ?? "indefinido";
  const cadastroLinkTier = deriveCadastroLinkTier(
    evidencias,
    pessoa !== null,
    comparacaoNome,
  );
  const extracaoConfirmada = mov.extracaoConfirmada === true;
  const extracaoDuvidosaRaw = isExtracaoDuvidosaMovimentacao({
    ...mov,
    extracaoConfirmada: false,
  });
  const extracaoDuvidosa = extracaoDuvidosaRaw && !extracaoConfirmada;
  const origens: PlanilhaOrigem[] = [
    {
      movimentacaoId: mov.id,
      arquivoIngestaoId:
        mov.arquivoIngestaoId ?? mov.origemExtracao?.arquivoIngestaoId ?? undefined,
      nomeArquivo: mov.nomeArquivo,
      pagina: mov.origemExtracao?.pagina,
      descricaoRaw: mov.descricaoRaw,
      nrExtratoBancario: mov.nrExtratoBancario,
      origemExtracao: mov.origemExtracao,
      indiceLinha: mov.origemExtracao?.indiceLinha,
      bbox: mov.origemExtracao?.bbox,
      camposExtracao: mov.camposExtracao ?? {},
    },
  ];
  return {
    id: mov.id,
    fonte: "movimentacao",
    dataMovimento: mov.dataMovimento,
    valor: mov.valor,
    direcao: mov.direcao,
    descricao: cleanDescricao(mov.descricaoRaw),
    descricaoRaw: mov.descricaoRaw,
    nrExtratoBancario: mov.nrExtratoBancario,
    confianca: mov.confiancaGlobal,
    status: deriveLinhaStatus({
      origemCount: 1,
      pessoa,
      confianca: mov.confiancaGlobal,
      extracaoDuvidosa,
      extracaoConfirmada,
    }),
    pessoa,
    remetenteDestinatario: campoExtracao(mov, 'remetente_destinatario') ?? null,
    origens,
    extracaoDuvidosa,
    extracaoConfirmada,
    cadastroLinkTier,
    comparacaoNome: pessoa ? comparacaoNome : null,
    camposExtracao: mov.camposExtracao ?? {},
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
    nrExtratoBancario: mov.nrExtratoBancario,
    confiancaGlobal: mov.confiancaGlobal,
    pessoaFisica: mov.pessoaFisica,
    pessoaJuridica: mov.pessoaJuridica,
    remetenteDestinatario: mov.remetenteDestinatario,
    nomeArquivo: mov.arquivoIngestao?.nomeArquivo ?? null,
    arquivoIngestaoId: mov.arquivoIngestaoId,
    origemExtracao: (mov.origemExtracao as OrigemExtracaoV1 | null) ?? null,
    statusPaginaVerificar: mov.evidencias.some((e) => e.tipo === "PAGINA_VERIFICAR"),
    extracaoConfirmada: mov.evidencias.some((e) => e.tipo === "EXTRACAO_CONFIRMADA"),
    evidencias: mov.evidencias.map((e) => ({ tipo: e.tipo })),
    camposExtracao: mov.camposExtracao as Record<string, string | null> | null,
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

  const resumo = buildResumo(linhas, cadastroAlerta);
  const ingestaoResumo = await buildIngestaoResumo(db, sessaoId, linhas, resumo);

  const arquivos = await db
    .select({
      id: arquivoIngestao.id,
      nomeArquivo: arquivoIngestao.nomeArquivo,
      metadados: arquivoIngestao.metadados,
    })
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.sessaoPrestacaoId, sessaoId));

  const modelIds = arquivos.map((arq) => {
    const meta = arq.metadados as Record<string, any> | null;
    const fromMeta = meta?.extratoModeloId;
    if (fromMeta && typeof fromMeta === "string") {
      return fromMeta as ExtratoModeloId;
    }
    return detectExtratoModeloFromFilename(arq.nomeArquivo);
  });

  const colMap = colunasFromModelos(modelIds);
  const colCampos = colunasFromCamposUnion(linhas.map((l) => l.camposExtracao));
  const combinedSet = new Set<string>([...colMap, ...colCampos]);
  const excluded = new Set(["data", "valor", "direcao"]);
  const filtered = Array.from(combinedSet).filter((col) => !excluded.has(col));
  const colunas = filtered.sort((a, b) => {
    const idxA = PLANILHA_COLUNA_ORDER.indexOf(a as any);
    const idxB = PLANILHA_COLUNA_ORDER.indexOf(b as any);
    if (idxA !== -1 && idxB !== -1) {
      return idxA - idxB;
    }
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.localeCompare(b);
  });

  const linhasOrdenadas = ordenarLinhasPlanilha(linhas);

  return {
    sessao: { id: sessao.id, uf: sessao.uf, exercicio: sessao.exercicio, mesReferencia: sessao.mesReferencia },
    linhas: linhasOrdenadas,
    resumo,
    ingestaoResumo,
    colunas,
  };
}
