import type { MovimentacaoAplicacao } from "./aplicacao";
import type { MovimentacaoDoacao } from "./doacao";
import type { MovimentacaoOrigem } from "./origem";

export const CNPJ_PRESTADOR = "23738595000182";
export const NR_RECIBO = "12345678";

const baseMov = {
  uf: "SP",
  exercicio: 2025,
  descricaoRaw: "fixture",
  credDev: null,
  hashMovimento: "hash-fixture",
  status: "CONFIRMADO" as const,
  confiancaGlobal: 1,
  bloqueioExport: false,
  arquivoIngestaoId: null,
  cnpjPrestador: CNPJ_PRESTADOR,
  tipoPrestador: "ESTADUAL",
  diretorioMunicipalId: null,
  sessaoPrestacaoId: null,
  movimentacaoCanonicaId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function origemPfPixFixture(): MovimentacaoOrigem {
  return {
    ...baseMov,
    id: "mov-origem-1",
    direcao: "ENTRADA",
    valor: "500.00",
    dataMovimento: "2025-04-10",
    nrExtratoBancario: "EXT001",
    contaBancariaId: "conta-1",
    pessoaFisicaId: "pf-1",
    pessoaJuridicaId: null,
    pessoaFisica: {
      cpf: "12345678909",
      nome: "Joao Silva",
      tituloEleitor: null,
    },
    pessoaJuridica: null,
    contaBancaria: {
      id: "conta-1",
      diretorioEstadualId: "dir-1",
      agencia: "1234",
      conta: "56789",
      dv: "0",
      ativo: true,
      createdAt: new Date(),
    },
    spca: {
      id: "spca-1",
      movimentacaoId: "mov-origem-1",
      modulos: null,
      fonteRecurso: "OR",
      naturezaRecurso: "0",
      tipoOrigemRecurso: "PF",
      classificacaoReceita: "314",
      especieRecurso: "PIX",
      cdDescricaoGasto: null,
      tipoDocumento: null,
      nrDocumento: null,
      dataEmissaoContratacao: null,
      detalheSituacao: null,
      descricaoResumida: null,
      nrReciboDoacao: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

export function aplicacaoPjReciboFixture(): MovimentacaoAplicacao {
  return {
    ...baseMov,
    id: "mov-aplic-1",
    direcao: "SAIDA",
    valor: "250.00",
    dataMovimento: "2025-05-12",
    descricaoRaw: "Despesa internet campanha",
    nrExtratoBancario: null,
    contaBancariaId: null,
    pessoaFisicaId: null,
    pessoaJuridicaId: "pj-1",
    pessoaFisica: null,
    pessoaJuridica: {
      cnpj: "11222333000181",
      razaoSocial: "Fornecedor LTDA",
    },
    spca: {
      id: "spca-aplic-1",
      movimentacaoId: "mov-aplic-1",
      modulos: null,
      fonteRecurso: null,
      naturezaRecurso: null,
      tipoOrigemRecurso: null,
      classificacaoReceita: null,
      especieRecurso: null,
      cdDescricaoGasto: "401",
      tipoDocumento: "RECIBO",
      nrDocumento: "REC-2025-001",
      dataEmissaoContratacao: "2025-05-12",
      detalheSituacao: 1,
      descricaoResumida: "Pagamento paginas internet",
      nrReciboDoacao: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

export function doacaoPfPixFixture(): MovimentacaoDoacao {
  return {
    ...origemPfPixFixture(),
    id: "mov-doacao-1",
    hashMovimento: "doacaohash001",
    spca: {
      ...origemPfPixFixture().spca,
      id: "spca-doacao-1",
      movimentacaoId: "mov-doacao-1",
      nrReciboDoacao: NR_RECIBO,
    },
  };
}
