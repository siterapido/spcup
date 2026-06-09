import type { OrigemExtracaoV1 } from "../provenance/types";
import { compararNomeComPessoa, type CadastroLinkTier } from "../match/cadastro-link";
import type { NomeCadastroComparacao } from "../match/nome-cadastro";
import { isNomeContraparteVazio } from "../match/nome-contraparte";
import { cleanDescricao } from "./descricao";
import { deriveLinhaStatus } from "./status";
import type { PlanilhaLinha, PlanilhaOrigem, PlanilhaPessoa } from "./types";
import { CamposExtracao, mergeCamposExtracao } from "../ingest/campos-extracao";

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
  remetenteDestinatario?: string | null;
  extracaoConfirmada?: boolean;
  matchEvidencias?: Array<{ tipo: string }>;
  pessoa: {
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
    aliases?: string[] | null;
  } | null;
  linhas: Array<{
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nrExtratoBancario: string | null;
    nomeArquivo: string | null;
    arquivoIngestaoId?: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
    camposExtracao: CamposExtracao | null;
  }>;
};

function mapPessoaFromConsolidacao(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaPessoa | null {
  if (!evento.pessoa) return null;
  const id = evento.pessoaFisicaId ?? evento.pessoaJuridicaId;
  if (!id) return null;
  return { id, ...evento.pessoa };
}

function origensFromLinhas(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
): PlanilhaOrigem[] {
  return linhas.map((l) => ({
    movimentacaoId: l.movimentacaoId,
    arquivoIngestaoId:
      l.origemExtracao?.arquivoIngestaoId ?? l.arquivoIngestaoId ?? undefined,
    nomeArquivo: l.nomeArquivo,
    pagina: l.origemExtracao?.pagina,
    descricaoRaw: l.descricaoRaw,
    nrExtratoBancario: l.nrExtratoBancario,
    papel: l.papel,
    origemExtracao: l.origemExtracao,
    indiceLinha: l.origemExtracao?.indiceLinha,
    bbox: l.origemExtracao?.bbox,
    camposExtracao: l.camposExtracao,
  }));
}

function descricaoFromLinhas(linhas: ConsolidacaoEventoLinhaInput["linhas"]): string {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return cleanDescricao(primary?.descricaoRaw ?? "");
}

function descricaoRawFromLinhas(linhas: ConsolidacaoEventoLinhaInput["linhas"]): string {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return primary?.descricaoRaw ?? "";
}

function nrExtratoBancarioFromLinhas(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
): string | null {
  const primary = linhas.find((l) => l.papel === "COMPLETO") ?? linhas[0];
  return primary?.nrExtratoBancario ?? null;
}

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

function isExtracaoDuvidosaConsolidacao(
  linhas: ConsolidacaoEventoLinhaInput["linhas"],
  confianca: number,
): boolean {
  return linhas.some((l) => !l.origemExtracao && confianca < EXTRACAO_DUVIDOSA_CONFIANCA);
}

export function mapConsolidacaoEventoToLinha(
  evento: ConsolidacaoEventoLinhaInput,
): PlanilhaLinha {
  const origens = origensFromLinhas(evento.linhas);
  const pessoa = mapPessoaFromConsolidacao(evento);
  const extracaoConfirmada = evento.extracaoConfirmada === true;
  const extracaoDuvidosaRaw = isExtracaoDuvidosaConsolidacao(
    evento.linhas,
    evento.confianca,
  );
  const extracaoDuvidosa = extracaoDuvidosaRaw && !extracaoConfirmada;
  const evidencias = evento.matchEvidencias ?? [];
  const comparacaoNome: NomeCadastroComparacao | null = pessoa
    ? isNomeContraparteVazio(evento.remetenteDestinatario)
      ? "indefinido"
      : compararNomeComPessoa(evento.remetenteDestinatario!, pessoa)
    : null;
  const cadastroLinkTier =
    evidencias.length > 0
      ? deriveCadastroLinkTier(
          evidencias,
          pessoa !== null,
          comparacaoNome ?? "indefinido",
        )
      : null;
  const camposExtracao = (evento.linhas || []).reduce((acc, l) => {
    return mergeCamposExtracao(acc, (l.camposExtracao as CamposExtracao) ?? {});
  }, {} as CamposExtracao);
  return {
    id: evento.id,
    fonte: "consolidacao",
    dataMovimento: evento.dataMovimento,
    valor: evento.valor,
    direcao: evento.direcao,
    descricao: descricaoFromLinhas(evento.linhas),
    descricaoRaw: descricaoRawFromLinhas(evento.linhas),
    nrExtratoBancario: nrExtratoBancarioFromLinhas(evento.linhas),
    confianca: evento.confianca,
    status: deriveLinhaStatus({
      eventoStatus: evento.status,
      origemCount: origens.length,
      pessoa,
      confianca: evento.confianca,
      extracaoDuvidosa,
      extracaoConfirmada,
    }),
    pessoa,
    remetenteDestinatario: evento.remetenteDestinatario ?? null,
    origens,
    eventoStatus: evento.status,
    extracaoDuvidosa,
    extracaoConfirmada,
    cadastroLinkTier,
    comparacaoNome,
    camposExtracao,
  };
}
