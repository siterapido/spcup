import { movimentacao, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { REQUIRED_SPCA_FIELDS } from "../confidence";
import { applyAiMatchToMovimentacao } from "../match/apply-ai";
import { applyDeterministicMatch } from "../match/rules";
import type { OrigemEnriquecimentoV1, OrigemExtracaoV1 } from "../provenance/types";

export interface MovimentacaoDetalhe {
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
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  arquivoIngestaoId: string | null;
  nomeArquivo: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  origemEnriquecimento: OrigemEnriquecimentoV1 | null;
  spca: {
    fonteRecurso: string | null;
    naturezaRecurso: string | null;
    tipoOrigemRecurso: string | null;
  } | null;
}

function lacunasFromEvidencias(
  evidencias: Array<{ tipo: string; detalhe: string | null }>,
): string[] {
  return evidencias
    .filter((e) => e.tipo === "LACUNA_XSD")
    .map((e) => e.detalhe ?? "")
    .filter(Boolean);
}

export async function getMovimentacaoDetalhe(
  db: Db,
  id: string,
): Promise<MovimentacaoDetalhe | null> {
  const mov = await db.query.movimentacao.findFirst({
    where: eq(movimentacao.id, id),
    with: {
      pessoaFisica: true,
      pessoaJuridica: true,
      arquivoIngestao: true,
      spca: true,
      evidencias: true,
    },
  });
  if (!mov) {
    return null;
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

  return {
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
    pessoaFisicaId: mov.pessoaFisicaId,
    pessoaJuridicaId: mov.pessoaJuridicaId,
    arquivoIngestaoId: mov.arquivoIngestaoId,
    nomeArquivo: mov.arquivoIngestao?.nomeArquivo ?? null,
    origemExtracao: (mov.origemExtracao as OrigemExtracaoV1 | null) ?? null,
    origemEnriquecimento: (mov.origemEnriquecimento as OrigemEnriquecimentoV1 | null) ?? null,
    spca: mov.spca
      ? {
          fonteRecurso: mov.spca.fonteRecurso,
          naturezaRecurso: mov.spca.naturezaRecurso,
          tipoOrigemRecurso: mov.spca.tipoOrigemRecurso,
        }
      : null,
  };
}

export type AssignPessoaInput =
  | { pessoaFisicaId: string }
  | { pessoaJuridicaId: string }
  | { limparPessoa: true };

export async function assignPessoaToMovimentacao(
  db: Db,
  id: string,
  pessoa: AssignPessoaInput,
): Promise<void> {
  const patch: {
    pessoaFisicaId: string | null;
    pessoaJuridicaId: string | null;
    updatedAt: Date;
  } = {
    pessoaFisicaId: null,
    pessoaJuridicaId: null,
    updatedAt: new Date(),
  };

  if ("pessoaFisicaId" in pessoa) {
    patch.pessoaFisicaId = pessoa.pessoaFisicaId;
  } else if ("pessoaJuridicaId" in pessoa) {
    patch.pessoaJuridicaId = pessoa.pessoaJuridicaId;
  }

  const [updated] = await db
    .update(movimentacao)
    .set(patch)
    .where(eq(movimentacao.id, id))
    .returning();
  if (!updated) {
    throw new Error(`Movimentacao ${id} not found`);
  }

  await applyDeterministicMatch(db, id);
}

export async function reprocessarIaMovimentacao(db: Db, id: string) {
  return applyAiMatchToMovimentacao(db, id);
}
