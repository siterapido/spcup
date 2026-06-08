/**
 * Browser-safe entry — no Node/fs/canvas/db. Use from Client Components instead of `@spc-up/core`.
 */
export {
  findCnpjInDescricao,
  findCpfInDescricao,
  hasCpfInDescricao,
  stripDocumentsFromDescricao,
} from "./match/document-in-text";

export { normalizeName } from "./normalize";
export {
  compararNomeCadastro,
  type NomeCadastroComparacao,
} from "./match/nome-cadastro";

export type {
  BboxNorm,
  CampoExtrato,
  OrigemAtributosEvento,
  OrigemEnriquecimentoV1,
  OrigemExtracaoV1,
  OrigemRef,
} from "./provenance/types";

export type {
  ConfiancaFaixas,
  SystemStats,
  SystemStatsGlobal,
  SystemStatsScope,
} from "./report/system-stats-types";

export {
  agruparItensEmLinhas,
  localizarLinhaPdf,
} from "./pdf-locate/localizar-linha-pdf";
export type {
  LinhaPdfAgrupada,
  LocalizarLinhaPdfInput,
  LocalizarLinhaPdfResult,
  PdfPaginaTexto,
  PdfTextItem,
} from "./pdf-locate/types";

export { ARQUIVO_INGESTAO_STATUS } from "./ingest/types";

export {
  mapConsolidacaoEventoToLinha,
  type ConsolidacaoEventoLinhaInput,
} from "./planilha/map-consolidacao-linha";

export type { CadastroLinkTier } from "./match/cadastro-link";

export type {
  IngestaoResumo,
  IngestaoResumoArquivo,
  IngestaoResumoPagina,
  PlanilhaLinha,
  PlanilhaLinhaFonte,
  PlanilhaLinhaStatus,
  PlanilhaOrigem,
  PlanilhaPayload,
  PlanilhaPessoa,
  PlanilhaResumo,
} from "./planilha/types";
