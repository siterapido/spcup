import { and, asc, eq } from "drizzle-orm";

import {
  type ContaBancaria,
  type Db,
  type Movimentacao,
  type MovimentacaoSpca,
  movimentacao,
} from "@spc-up/db";

import {
  buildCabecalho,
  exportPath,
  formatMoeda,
  makeOrigemRoot,
  sub,
  writeXml,
  xmlToBuffer,
} from "./common";
import { scopePrestadorExercicio } from "./scope";

const ESPECIE_TAG: Record<string, string> = {
  PIX: "transferenciaEletronicaPIX",
  TED: "transferenciaEletronicaTED",
  TEL: "transferenciaEletronicaTEL",
  TEB: "transferenciaEletronicaTEB",
  CH: "depositoCheque",
  EP: "depositoEspecie",
  OB: "ordemBancaria",
  CC: "cartaoCredito",
  AC: "avisoCredito",
  OT: "outrosTitulosCredito",
};

const CONTA_DESTINO_TAGS = new Set([
  "transferenciaEletronicaPIX",
  "transferenciaEletronicaTED",
  "transferenciaEletronicaTEL",
  "transferenciaEletronicaTEB",
  "depositoCheque",
  "avisoCredito",
  "depositoEspecie",
  "ordemBancaria",
  "cartaoCredito",
]);

export type MovimentacaoOrigem = Movimentacao & {
  spca: MovimentacaoSpca;
  pessoaFisica: { cpf: string; nome: string; tituloEleitor: string | null } | null;
  pessoaJuridica: { cnpj: string; razaoSocial: string } | null;
  contaBancaria: ContaBancaria | null;
};

async function fetchMovimentacoes(
  db: Db,
  cnpjPrestador: string,
  exercicio: number,
): Promise<MovimentacaoOrigem[]> {
  const rows = await db.query.movimentacao.findMany({
    where: and(
      scopePrestadorExercicio(cnpjPrestador, exercicio),
      eq(movimentacao.direcao, "ENTRADA"),
      eq(movimentacao.status, "CONFIRMADO"),
    ),
    with: {
      spca: true,
      pessoaFisica: true,
      pessoaJuridica: true,
      contaBancaria: true,
    },
    orderBy: [asc(movimentacao.dataMovimento), asc(movimentacao.id)],
  });

  return rows.filter((row) => row.spca != null) as MovimentacaoOrigem[];
}

function formatDate(value: string | Date): string {
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function appendContaDestino(parent: ReturnType<typeof sub>, conta: ContaBancaria | null): void {
  const contaDestino = sub(parent, "contaBancariaDestino");
  const banco = sub(contaDestino, "bancoDestino");
  if (conta == null) {
    sub(banco, "nrBancoDestino", "000");
    sub(banco, "agenciaDestino", "0000");
    sub(banco, "contaCorrente", "0");
    sub(banco, "dvContaCorrente", "0");
    return;
  }
  sub(banco, "nrBancoDestino", "000");
  sub(banco, "agenciaDestino", conta.agencia);
  sub(banco, "contaCorrente", conta.conta);
  sub(banco, "dvContaCorrente", conta.dv ?? "0");
}

function appendEspecieRecurso(
  parent: ReturnType<typeof sub>,
  spca: MovimentacaoSpca,
  mov: MovimentacaoOrigem,
): void {
  const especie = (spca.especieRecurso ?? "PIX").toUpperCase();
  const tag = ESPECIE_TAG[especie] ?? "transferenciaEletronicaPIX";
  const especieWrapper = sub(parent, "especieRecurso");
  const especieNode = sub(especieWrapper, tag);
  sub(especieNode, "especieRecurso", especie);
  if (mov.nrExtratoBancario) {
    sub(especieNode, "nrExtratoBancario", mov.nrExtratoBancario);
  }
  if (CONTA_DESTINO_TAGS.has(tag)) {
    appendContaDestino(especieNode, mov.contaBancaria);
  }
}

function appendOrigemRecurso(
  parent: ReturnType<typeof sub>,
  spca: MovimentacaoSpca,
  mov: MovimentacaoOrigem,
): void {
  const origemRecurso = sub(parent, "origemRecurso");
  const tipo = (spca.tipoOrigemRecurso ?? "PF").toUpperCase();

  if (tipo === "PF") {
    const pessoa = mov.pessoaFisica;
    if (pessoa == null) {
      throw new Error(`Movimentacao ${mov.id} requires pessoa_fisica for PF origem`);
    }
    const pf = sub(origemRecurso, "pessoaFisica");
    sub(pf, "tipo", "PF");
    sub(pf, "nrCpf", pessoa.cpf);
    sub(pf, "nmPessoa", pessoa.nome);
    if (pessoa.tituloEleitor) {
      sub(pf, "tituloEleitor", pessoa.tituloEleitor);
    }
    return;
  }

  if (tipo === "PJ") {
    const pessoa = mov.pessoaJuridica;
    if (pessoa == null) {
      throw new Error(`Movimentacao ${mov.id} requires pessoa_juridica for PJ origem`);
    }
    const pj = sub(origemRecurso, "pessoaJuridica");
    sub(pj, "tipo", "PJ");
    sub(pj, "nrCnpj", pessoa.cnpj);
    sub(pj, "nmPessoa", pessoa.razaoSocial);
    return;
  }

  throw new Error(`Unsupported tipo_origem_recurso: ${tipo}`);
}

function appendOrigemItem(parent: ReturnType<typeof sub>, mov: MovimentacaoOrigem): void {
  const spca = mov.spca;
  const origem = sub(parent, "origem");
  sub(origem, "dtEntrada", formatDate(mov.dataMovimento));
  sub(origem, "vrOrigem", formatMoeda(mov.valor));
  sub(origem, "fonteRecurso", spca.fonteRecurso);
  sub(origem, "naturezaRecurso", spca.naturezaRecurso);
  appendOrigemRecurso(origem, spca, mov);
  sub(origem, "classificacaoReceita", spca.classificacaoReceita);
  if (spca.descricaoResumida) {
    sub(origem, "descricaoResumida", spca.descricaoResumida);
  }
  if (spca.nrReciboDoacao) {
    sub(origem, "nrReciboDoacao", spca.nrReciboDoacao);
  }
  appendEspecieRecurso(origem, spca, mov);
}

export function buildOrigemDocument(
  movimentacoes: MovimentacaoOrigem[],
  cnpj: string,
  exercicio: number,
) {
  const root = makeOrigemRoot();
  buildCabecalho(root, { cnpj, exercicio });
  const corpo = sub(root, "CORPO");
  const origens = sub(corpo, "origens");
  sub(origens, "totalOrigem", movimentacoes.length);
  for (const mov of movimentacoes) {
    appendOrigemItem(origens, mov);
  }
  return root;
}

/** Build and persist Origem de Recursos XML for confirmed entradas. */
export async function buildOrigemXml(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<string> {
  const movimentacoes = await fetchMovimentacoes(db, cnpj, exercicio);
  const doc = buildOrigemDocument(movimentacoes, cnpj, exercicio);
  return writeXml(doc, exportPath(uf.toUpperCase(), exercicio, cnpj, "origem"));
}

export async function buildOrigemXmlBuffer(
  db: Db,
  uf: string,
  exercicio: number,
  cnpj: string,
): Promise<Buffer> {
  const movimentacoes = await fetchMovimentacoes(db, cnpj, exercicio);
  return xmlToBuffer(buildOrigemDocument(movimentacoes, cnpj, exercicio));
}
