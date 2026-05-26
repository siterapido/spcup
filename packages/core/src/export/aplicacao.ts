import { and, asc, eq } from "drizzle-orm";

import { type Db, type Movimentacao, type MovimentacaoSpca, movimentacao } from "@spc-up/db";

import {
  buildCabecalho,
  exportPath,
  formatMoeda,
  makeAplicacaoRoot,
  sub,
  writeXml,
  xmlToBuffer,
} from "./common";

const DOCUMENTO_TAG: Record<string, string> = {
  BOLETO: "boleto",
  CONTRATO: "contrato",
  FISCAL: "fiscal",
  FATURA: "fatura",
  RECIBO: "recibo",
  OUTRO: "outro",
};

const DEFAULT_CD_GASTO = "401";
const DEFAULT_DETALHE_SITUACAO = 1;
const DEFAULT_TIPO_DOCUMENTO = "RECIBO";

export type MovimentacaoAplicacao = Movimentacao & {
  spca: MovimentacaoSpca;
  pessoaFisica: { cpf: string; nome: string } | null;
  pessoaJuridica: { cnpj: string; razaoSocial: string } | null;
};

async function fetchMovimentacoes(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<MovimentacaoAplicacao[]> {
  const rows = await db.query.movimentacao.findMany({
    where: and(
      eq(movimentacao.uf, uf.toUpperCase()),
      eq(movimentacao.exercicio, exercicio),
      eq(movimentacao.direcao, "SAIDA"),
      eq(movimentacao.status, "CONFIRMADO"),
    ),
    with: { spca: true, pessoaFisica: true, pessoaJuridica: true },
    orderBy: [asc(movimentacao.dataMovimento), asc(movimentacao.id)],
  });

  return rows.filter((row) => row.spca != null) as MovimentacaoAplicacao[];
}

function formatDate(value: string | Date): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function appendPessoa(parent: ReturnType<typeof sub>, mov: MovimentacaoAplicacao): void {
  const pessoaWrapper = sub(parent, "pessoa");

  if (mov.pessoaJuridica != null) {
    const pjNode = sub(pessoaWrapper, "pessoaJuridica");
    sub(pjNode, "nrCnpj", mov.pessoaJuridica.cnpj);
    sub(pjNode, "nmPessoa", mov.pessoaJuridica.razaoSocial);
    return;
  }

  if (mov.pessoaFisica != null) {
    const pfNode = sub(pessoaWrapper, "pessoaFisica");
    sub(pfNode, "nrCpf", mov.pessoaFisica.cpf);
    sub(pfNode, "nmPessoa", mov.pessoaFisica.nome);
    return;
  }

  throw new Error(
    `Movimentacao ${mov.id} requires pessoa_fisica or pessoa_juridica for aplicacao`,
  );
}

function appendDadosDocumento(
  parent: ReturnType<typeof sub>,
  spca: MovimentacaoSpca,
  mov: MovimentacaoAplicacao,
): void {
  const tipo = (spca.tipoDocumento ?? DEFAULT_TIPO_DOCUMENTO).toUpperCase();
  const tag = DOCUMENTO_TAG[tipo] ?? "recibo";
  const dados = sub(parent, "dadosDocumento");
  const doc = sub(dados, tag);

  if (tag === "outro") {
    const descricao = spca.descricaoResumida ?? mov.descricaoRaw;
    sub(doc, "descricao", descricao.slice(0, 20));
  }
  if (spca.nrDocumento) {
    sub(doc, "nrDocumento", spca.nrDocumento);
  }
  const dataEmissao = spca.dataEmissaoContratacao ?? mov.dataMovimento;
  sub(doc, "dataEmissaoContratacao", formatDate(dataEmissao));
  sub(doc, "vrTotalDocumento", formatMoeda(mov.valor));
}

function appendDetalheSituacao(
  gastoConta: ReturnType<typeof sub>,
  spca: MovimentacaoSpca,
  mov: MovimentacaoAplicacao,
): void {
  const situacao =
    spca.detalheSituacao != null ? spca.detalheSituacao : DEFAULT_DETALHE_SITUACAO;
  if (situacao !== 1) {
    return;
  }
  const descricao = spca.descricaoResumida ?? mov.descricaoRaw;
  const situacaoNode = sub(gastoConta, "situacao1");
  sub(situacaoNode, "descricaoResumida", descricao);
}

function appendClassificacaoGasto(
  parent: ReturnType<typeof sub>,
  spca: MovimentacaoSpca,
  mov: MovimentacaoAplicacao,
): void {
  const classificacao = sub(parent, "classificacaoGasto");
  const gastoConta = sub(classificacao, "gastoContaContabil");
  const cdGasto = spca.cdDescricaoGasto ?? DEFAULT_CD_GASTO;
  sub(gastoConta, "cdDescricaoGasto", cdGasto);
  sub(gastoConta, "vrGasto", formatMoeda(mov.valor));
  appendDetalheSituacao(gastoConta, spca, mov);
}

function appendGasto(parent: ReturnType<typeof sub>, mov: MovimentacaoAplicacao): void {
  const gasto = sub(parent, "gasto");
  appendPessoa(gasto, mov);
  appendDadosDocumento(gasto, mov.spca, mov);
  appendClassificacaoGasto(gasto, mov.spca, mov);
}

export function buildAplicacaoDocument(
  movimentacoes: MovimentacaoAplicacao[],
  cnpj: string,
  exercicio: number,
) {
  const root = makeAplicacaoRoot();
  buildCabecalho(root, { cnpj, exercicio });
  const corpo = sub(root, "CORPO");
  for (const mov of movimentacoes) {
    appendGasto(corpo, mov);
  }
  return root;
}

export async function buildAplicacaoXml(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<string> {
  const movimentacoes = await fetchMovimentacoes(db, uf, exercicio);
  const doc = buildAplicacaoDocument(movimentacoes, cnpj, exercicio);
  return writeXml(doc, exportPath(uf.toUpperCase(), exercicio, cnpj, "aplicacao"));
}

export async function buildAplicacaoXmlBuffer(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<Buffer> {
  const movimentacoes = await fetchMovimentacoes(db, uf, exercicio);
  return xmlToBuffer(buildAplicacaoDocument(movimentacoes, cnpj, exercicio));
}
