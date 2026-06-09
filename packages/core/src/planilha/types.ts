import type { CadastroLinkTier } from "../match/cadastro-link";
import type { NomeCadastroComparacao } from "../match/nome-cadastro";
import type { OrigemExtracaoV1, BboxNorm } from "../provenance/types";
import type { CamposExtracao } from "../ingest/campos-extracao";

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
  camposExtracao?: CamposExtracao | null;
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
  remetenteDestinatario: string | null;
  origens: PlanilhaOrigem[];
  /** Metadados internos para deriveLinhaStatus / escrita */
  eventoStatus?: string;
  extracaoDuvidosa: boolean;
  /** Operador confirmou extração (valor/data) na planilha */
  extracaoConfirmada: boolean;
  cadastroLinkTier?: CadastroLinkTier | null;
  comparacaoNome?: NomeCadastroComparacao | null;
  camposExtracao: CamposExtracao;
};

export type PlanilhaResumo = {
  total: number;
  prontas: number;
  semPessoa: number;
  semRemetenteDestinatario: number;
  baixaConfianca: number;
  mergePendente: number;
  extracaoDuvidosa: number;
  cadastroAlerta: boolean;
  exportavel: boolean;
  docSemCadastro: number;
  nomeDiverge: number;
};

export type IngestaoResumoPagina = {
  pagina: number;
  status: string;
  aceitas: number;
  incertas: number;
  motivo?: string | null;
};

export type IngestaoResumoArquivo = {
  id: string;
  nomeArquivo: string;
  status: string;
  movimentacoesExtraidas: number;
  linhasIgnoradasSemDoc: number;
  paginasVerificar: number;
  linhasPlanilha: number;
  paginas: IngestaoResumoPagina[];
  motor?: string | null;
  avisosBalance?: string[];
  transacoesExtraidasMetadados?: number | null;
};

export type IngestaoResumo = {
  movimentacoesBrutas: number;
  linhasPlanilha: number;
  mergesPendentes: number;
  arquivos: IngestaoResumoArquivo[];
};

export type PlanilhaPayload = {
  sessao: { id: string; uf: string; exercicio: number; mesReferencia?: string | null };
  linhas: PlanilhaLinha[];
  resumo: PlanilhaResumo;
  ingestaoResumo: IngestaoResumo;
  colunas: string[];
};
