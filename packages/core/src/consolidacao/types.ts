import type { CONSOLIDACAO_LINHA_PAPEL } from "@spc-up/db";

export type ConsolidacaoLinhaPapel =
  (typeof CONSOLIDACAO_LINHA_PAPEL)[keyof typeof CONSOLIDACAO_LINHA_PAPEL];

export type MovimentacaoCandidate = {
  id: string;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricaoRaw: string;
  cpfExtraido: string | null;
  cnpjExtraido: string | null;
};

export type PessoaRef =
  | { kind: "PF"; id: string; nome: string }
  | { kind: "PJ"; id: string; nome: string };

export type CadastroMatchContext = {
  pessoaByCpf: Map<string, PessoaRef>;
  pessoaByCnpj: Map<string, PessoaRef>;
};

export type ConsolidacaoLinhaDraft = {
  movimentacaoId: string;
  arquivoIngestaoId: string;
  papel: ConsolidacaoLinhaPapel;
  descricaoRaw: string;
};

export type ConsolidacaoHipoteseDraft = {
  tipo: string;
  confianca: number;
  payload: Record<string, unknown>;
};

export type ConsolidacaoEventDraft = {
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string;
  pessoaFisicaId?: string;
  pessoaJuridicaId?: string;
  linhas: ConsolidacaoLinhaDraft[];
  hipoteses: ConsolidacaoHipoteseDraft[];
  evidencias: Array<{ tipo: string; detalhe: string; peso: number }>;
};
