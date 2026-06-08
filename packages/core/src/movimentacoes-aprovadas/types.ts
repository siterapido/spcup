export type MovimentacaoAprovadaStatus = "CONFIRMADO" | "EXPORTADO";

export type MovimentacaoAprovadaItem = {
  id: string;
  uf: string;
  exercicio: number;
  data_movimento: string;
  valor: string;
  direcao: string;
  descricao_raw: string;
  cred_dev: string | null;
  status: MovimentacaoAprovadaStatus;
  confianca_global: number;
  pessoa_nome: string | null;
  pessoa_documento: string | null;
  cnpj_prestador: string;
  prestador_nome: string | null;
  sessao_prestacao_id: string | null;
  nome_arquivo: string | null;
};

export type MovimentacoesAprovadasResumo = {
  confirmadas: number;
  exportadas: number;
};

export type MovimentacoesAprovadasPrestador = {
  cnpj: string;
  nome: string | null;
};

export type MovimentacoesAprovadasPayload = {
  uf: string;
  mes: string;
  exercicio: number;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  resumo: MovimentacoesAprovadasResumo;
  prestadores: MovimentacoesAprovadasPrestador[];
  items: MovimentacaoAprovadaItem[];
};

export type MovimentacoesAprovadasFilters = {
  uf: string;
  mes: string;
  page?: number;
  limit?: number;
};

export type MovimentacoesAprovadasExportFilters = {
  uf: string;
  mes: string;
};

export type MesFilter = {
  exercicio: number;
  from: string;
  to: string;
};
