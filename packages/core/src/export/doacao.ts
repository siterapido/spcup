import { eq } from "drizzle-orm";

import {
  type ContaBancaria,
  type Db,
  type Movimentacao,
  type MovimentacaoSpca,
  doacaoFinanceiraLink,
} from "@spc-up/db";

import {
  buildCabecalho,
  exportPath,
  formatMoeda,
  makeDoacaoRoot,
  sub,
  writeXml,
  xmlToBuffer,
} from "./common";

const DEFAULT_NUM_PARTIDO = 13;
const FORMA_DOACAO: Record<string, string> = {
  PIX: "PIX",
  TED: "TED",
  TEL: "TEL",
  TEB: "TEB",
  CH: "CH",
};
const OPERACAO_FINANCEIRA: Record<string, string> = {
  PIX: "PIX",
  TED: "TED",
  TEL: "TEL",
  EP: "EP",
};

export type MovimentacaoDoacao = Movimentacao & {
  spca: MovimentacaoSpca;
  pessoaFisica: { cpf: string; nome: string; tituloEleitor: string | null } | null;
  contaBancaria: ContaBancaria | null;
};

async function fetchMovimentacoes(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<MovimentacaoDoacao[]> {
  const ufUpper = uf.toUpperCase();
  const links = await db.query.doacaoFinanceiraLink.findMany({
    where: eq(doacaoFinanceiraLink.sincronizado, true),
    with: {
      movimentacaoOrigem: {
        with: { spca: true, pessoaFisica: true, contaBancaria: true },
      },
    },
  });

  return links
    .map((link) => link.movimentacaoOrigem)
    .filter(
      (mov) =>
        mov != null &&
        mov.uf === ufUpper &&
        mov.exercicio === exercicio &&
        mov.direcao === "ENTRADA" &&
        mov.status === "CONFIRMADO" &&
        mov.spca != null,
    )
    .sort((a, b) => {
      const byDate = String(a.dataMovimento).localeCompare(String(b.dataMovimento));
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    }) as MovimentacaoDoacao[];
}

function formatDate(value: string | Date): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function appendContaDestino(
  parent: ReturnType<typeof sub>,
  conta: ContaBancaria | null,
): void {
  const contaDestino = sub(parent, "contaBancariaDestino");
  const banco = sub(contaDestino, "bancoDestino");
  if (conta == null) {
    sub(banco, "nrBancoOrigem", "000");
    sub(banco, "agenciaOrigem", "0000");
    sub(banco, "contaCorrente", "0");
    sub(banco, "dvContaCorrente", "0");
    return;
  }
  sub(banco, "nrBancoOrigem", "000");
  sub(banco, "agenciaOrigem", conta.agencia);
  sub(banco, "contaCorrente", conta.conta);
  sub(banco, "dvContaCorrente", conta.dv ?? "0");
}

function appendBeneficiario(
  parent: ReturnType<typeof sub>,
  options: { cnpj: string; uf: string; exercicio: number },
): void {
  const beneficiario = sub(parent, "beneficiario");
  const partido = sub(beneficiario, "partido");
  sub(partido, "tipo", "PP");
  sub(partido, "nrCnpj", options.cnpj);
  sub(partido, "esferaPartidaria", "ESTADUAL");
  sub(partido, "eleicao", options.exercicio);
  sub(partido, "eleicaoSuplementar", "N");
  sub(partido, "partido", DEFAULT_NUM_PARTIDO);
  sub(partido, "uf", options.uf);
}

function appendDoador(
  parent: ReturnType<typeof sub>,
  mov: MovimentacaoDoacao,
  spca: MovimentacaoSpca,
): void {
  const pessoa = mov.pessoaFisica;
  if (pessoa == null) {
    throw new Error(`Movimentacao ${mov.id} requires pessoa_fisica for doacao export`);
  }
  const recibo = spca.nrReciboDoacao;
  if (!recibo) {
    throw new Error(`Movimentacao ${mov.id} missing nr_recibo_doacao`);
  }

  const doadores = sub(parent, "doadoresOriginarios");
  const dador = sub(doadores, "dadorOriginario");
  const pf = sub(dador, "pessoaFisica");
  sub(pf, "nrCpf", pessoa.cpf);
  sub(pf, "nmPessoa", pessoa.nome);
  if (pessoa.tituloEleitor) {
    sub(pf, "tituloEleitor", pessoa.tituloEleitor);
  }
  sub(pf, "nrReciboDoacao", recibo);
  sub(pf, "vrDoacao", formatMoeda(mov.valor));
}

function appendDoacaoItem(
  parent: ReturnType<typeof sub>,
  mov: MovimentacaoDoacao,
  options: { cnpj: string; uf: string; exercicio: number },
): void {
  const spca = mov.spca;
  const doacao = sub(parent, "doacao");
  appendBeneficiario(doacao, options);
  sub(doacao, "dtDoacao", formatDate(mov.dataMovimento));
  sub(doacao, "fonteRecurso", spca.fonteRecurso ?? "OR");

  const classificacao = sub(doacao, "classificacoesDoacao");
  sub(classificacao, "valorDoacao", formatMoeda(mov.valor));

  const especie = (spca.especieRecurso ?? "PIX").toUpperCase();
  sub(doacao, "formaDoacao", FORMA_DOACAO[especie] ?? "PIX");
  const operacao = OPERACAO_FINANCEIRA[especie];
  if (operacao) {
    sub(doacao, "operacaoFinanceira", operacao);
  }

  const nrExtrato = mov.nrExtratoBancario ?? spca.nrReciboDoacao ?? "0";
  sub(doacao, "nrExtratoBancario", nrExtrato);
  sub(doacao, "contaBancariaOrigem");
  sub(doacao, "nrDocumento", nrExtrato);
  sub(doacao, "nrReciboDoacao", spca.nrReciboDoacao);
  appendDoador(doacao, mov, spca);
  appendContaDestino(doacao, mov.contaBancaria);
}

export function buildDoacaoDocument(
  movimentacoes: MovimentacaoDoacao[],
  cnpj: string,
  uf: string,
  exercicio: number,
) {
  const root = makeDoacaoRoot();
  buildCabecalho(root, { cnpj, exercicio });
  const corpo = sub(root, "CORPO");
  const doacoes = sub(corpo, "doacoes");
  sub(doacoes, "totalDoacao", movimentacoes.length);
  const ufUpper = uf.toUpperCase();
  for (const mov of movimentacoes) {
    appendDoacaoItem(doacoes, mov, { cnpj, uf: ufUpper, exercicio });
  }
  return root;
}

export async function buildDoacaoXml(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<string> {
  const movimentacoes = await fetchMovimentacoes(db, uf, exercicio);
  const doc = buildDoacaoDocument(movimentacoes, cnpj, uf, exercicio);
  return writeXml(doc, exportPath(uf.toUpperCase(), exercicio, cnpj, "doacao"));
}

export async function buildDoacaoXmlBuffer(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<Buffer> {
  const movimentacoes = await fetchMovimentacoes(db, uf, exercicio);
  return xmlToBuffer(buildDoacaoDocument(movimentacoes, cnpj, uf, exercicio));
}
