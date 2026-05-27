import {
  arquivoIngestao,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
  type Db,
} from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";

import type { OrigemExtracaoV1 } from "../provenance/types";
import type { CadastroMatchContext, MovimentacaoCandidate, PessoaRef } from "./types";

export async function loadMovimentacaoCandidates(
  db: Db,
  sessaoId: string,
): Promise<MovimentacaoCandidate[]> {
  const rows = await db
    .select({
      id: movimentacao.id,
      arquivoIngestaoId: movimentacao.arquivoIngestaoId,
      nomeArquivo: arquivoIngestao.nomeArquivo,
      dataMovimento: movimentacao.dataMovimento,
      valor: movimentacao.valor,
      direcao: movimentacao.direcao,
      descricaoRaw: movimentacao.descricaoRaw,
      origemExtracao: movimentacao.origemExtracao,
    })
    .from(movimentacao)
    .innerJoin(arquivoIngestao, eq(movimentacao.arquivoIngestaoId, arquivoIngestao.id))
    .where(
      and(
        eq(movimentacao.sessaoPrestacaoId, sessaoId),
        isNull(movimentacao.movimentacaoCanonicaId),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    arquivoIngestaoId: row.arquivoIngestaoId ?? "",
    nomeArquivo: row.nomeArquivo,
    dataMovimento: String(row.dataMovimento),
    valor: String(row.valor),
    direcao: row.direcao,
    descricaoRaw: row.descricaoRaw,
    cpfExtraido: null,
    cnpjExtraido: null,
    origemExtracao: (row.origemExtracao as OrigemExtracaoV1 | null) ?? null,
  }));
}

export async function countPdfIngestoesForSessao(
  db: Db,
  sessaoId: string,
): Promise<number> {
  const rows = await db
    .select({ id: arquivoIngestao.id, nomeArquivo: arquivoIngestao.nomeArquivo })
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.sessaoPrestacaoId, sessaoId));

  return rows.filter((r) => /\.pdf$/i.test(r.nomeArquivo)).length;
}

export async function loadCadastroMatchContext(db: Db): Promise<CadastroMatchContext> {
  const pfs = await db.select({ id: pessoaFisica.id, cpf: pessoaFisica.cpf, nome: pessoaFisica.nome }).from(pessoaFisica);
  const pjs = await db
    .select({ id: pessoaJuridica.id, cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
    .from(pessoaJuridica);

  const pessoaByCpf = new Map<string, PessoaRef>();
  for (const pf of pfs) {
    pessoaByCpf.set(pf.cpf, { kind: "PF", id: pf.id, nome: pf.nome });
  }

  const pessoaByCnpj = new Map<string, PessoaRef>();
  for (const pj of pjs) {
    pessoaByCnpj.set(pj.cnpj, { kind: "PJ", id: pj.id, nome: pj.nome });
  }

  return { pessoaByCpf, pessoaByCnpj };
}
