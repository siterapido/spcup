import type { OrigemExtracaoV1, BboxNorm } from "../provenance/types";

export type PlanilhaLinhaStatus =
  | "pronta"
  | "pendente"
  | "merge_pendente"
  | "extracao_duvidosa";

export type PlanilhaLinhaFonte = "consolidacao" | "movimentacao";

export type PlanilhaPessoa = {
  id: string;
  tipo: "PF" | "PJ";
  nome: string;
  documento: string;
};

export type PlanilhaOrigem = {
  movimentacaoId: string;
  arquivoIngestaoId?: string;
  nomeArquivo: string | null;
  pagina?: number;
  descricaoRaw: string;
  nrExtratoBancario: string | null;
  papel?: string;
  origemExtracao?: OrigemExtracaoV1 | null;
  indiceLinha?: number;
  bbox?: BboxNorm;
};

export type PlanilhaLinha = {
  id: string;
  fonte: PlanilhaLinhaFonte;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricao: string;
  descricaoRaw: string;
  nrExtratoBancario: string | null;
  confianca: number;
  status: PlanilhaLinhaStatus;
  pessoa: PlanilhaPessoa | null;
  /** Nome efetivo para exibição (persistido ou derivado) */
  nome: string;
  /** Valor persistido em nome_contraparte; null = só derivado */
  nomeContraparte: string | null;
  /** true quando nome vem só da derivação das origens */
  nomeDerivado: boolean;
  origens: PlanilhaOrigem[];
  /** Metadados internos para deriveLinhaStatus / escrita */
  eventoStatus?: string;
  extracaoDuvidosa: boolean;
  /** Operador confirmou extração (valor/data) na planilha */
  extracaoConfirmada: boolean;
};

export type PlanilhaResumo = {
  total: number;
  prontas: number;
  semPessoa: number;
  semNome: number;
  baixaConfianca: number;
  mergePendente: number;
  extracaoDuvidosa: number;
  cadastroAlerta: boolean;
  exportavel: boolean;
};

export type PlanilhaPayload = {
  sessao: { id: string; uf: string; exercicio: number };
  linhas: PlanilhaLinha[];
  resumo: PlanilhaResumo;
};
