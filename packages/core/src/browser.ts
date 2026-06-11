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
  OrigemAncoragem,
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
  buildCamposExtracaoFromExtratoItem,
  buildCamposExtracaoFromNotebookTx,
  campoExtracao,
  espelharCamposLegados,
  mergeCamposExtracao,
  type CamposExtracao,
  type MovimentacaoCamposLike,
} from "./ingest/campos-extracao";

export {
  mapConsolidacaoEventoToLinha,
  type ConsolidacaoEventoLinhaInput,
} from "./planilha/map-consolidacao-linha";

export type { CadastroLinkTier } from "./match/cadastro-link";

export {
  type ExtratoModeloId,
  EXTRATO_MODELO_LABELS,
  detectExtratoModeloFromFilename,
  extratoColumnMapForModelo,
} from "./ingest/extrato-modelo";

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

export { getOrigemDestaque } from "./planilha";

export {
  ordenarLinhasPlanilha,
  isPlanilhaOrdenacao,
  PLANILHA_ORDENACAO_PADRAO,
  PLANILHA_ORDENACAO_OPCOES,
  type PlanilhaOrdenacao,
} from "./planilha/ordenar-linhas";

export {
  compareLinhasPlanilhaCronologicamente,
  ordenarLinhasPlanilhaCronologicamente,
} from "./planilha/ordenar-linhas-cronologico";

export {
  explicarDiferencaDataPixCompleto,
  type DiferencaDataPixCompleto,
} from "./consolidacao/explicar-diferenca-data";


