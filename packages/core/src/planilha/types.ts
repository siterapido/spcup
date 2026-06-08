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
  papel?: string;
};

export type PlanilhaLinha = {
  id: string;
  fonte: PlanilhaLinhaFonte;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricao: string;
  confianca: number;
  status: PlanilhaLinhaStatus;
  pessoa: PlanilhaPessoa | null;
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
