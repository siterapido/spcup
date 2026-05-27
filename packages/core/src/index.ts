export {
  DEFAULT_CONFLICT_CAP,
  DEFAULT_WEIGHTS,
  REQUIRED_SPCA_FIELDS,
  type Evidence,
  type MovimentacaoEvidenceLike,
  type MovimentacaoLike,
  type MovimentacaoSpcaLike,
  computeConfidence,
  evaluateMovimentacao,
} from "./confidence";
export { confirmMovimentacoes, type ConfirmResult } from "./confirm";
export { canExport, canExportByPrestador } from "./export/guard";
export { buildExcelMirrorBuffer } from "./export/excel-mirror";
export { exportPrestacaoZip, exportBundleByPrestador } from "./export/run";
export {
  buildAplicacaoXml,
  buildAplicacaoXmlBuffer,
} from "./export/aplicacao";
export {
  buildDoacaoXml,
  buildDoacaoXmlBuffer,
} from "./export/doacao";
export {
  buildOrigemXml,
  buildOrigemXmlBuffer,
} from "./export/origem";
export {
  exportBundle,
  exportSpcaZip,
  ExportBlockedError,
} from "./export/run";
export {
  requireValidXsd,
  validateSpcaExports,
  XsdValidationError,
} from "./export/validation";
export {
  APLICACAO_NS,
  DOACAO_NS,
  ORIGEM_NS,
  buildCabecalho,
  exportPath,
  formatMoeda,
  makeAplicacaoRoot,
  makeDoacaoRoot,
  makeOrigemRoot,
  storageRoot,
  sub,
  writeXml,
  xmlToBuffer,
} from "./export/common";
export {
  extractStructuredFromPdf,
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  resolveExtratoModel,
  type ExtratoExtraction,
  type ExtractStructuredOptions,
} from "./ai/openrouter";
export {
  classifyIngestError,
  toIngestError,
  IngestError,
  type IngestErrorCodigo,
  type IngestErrorDetail,
} from "./ingest/errors";
export { ingestLog, type IngestFase, type IngestLogFields } from "./ingest/log";
export {
  createSessao,
  getSessao,
  prestadorFromSessao,
  resolveCnpjPrestador,
  type CreateSessaoInput,
  type PrestadorResolvido,
} from "./prestacao/sessao";
export {
  approveConsolidacaoEvento,
  rejectConsolidacaoEvento,
} from "./consolidacao/approve";
export {
  type BboxNorm,
  type CampoExtrato,
  type OrigemAtributosEvento,
  type OrigemEnriquecimentoV1,
  type OrigemExtracaoV1,
  type OrigemRef,
} from "./provenance/types";
export { clampBbox, validateOrigemExtracao } from "./provenance/validate";
export { origemFromExtratoItem, type AttachExtracaoCtx } from "./provenance/attach-extracao";
export { buildOrigemAtributos, regraFromJustificativa } from "./provenance/build-origem-atributos";
export { readArquivoIngestaoBuffer } from "./storage/read-arquivo";
export { buildConsolidacaoCandidates } from "./consolidacao/candidates";
export {
  consolidateSession,
  type ConsolidateSessionResult,
} from "./consolidacao/run";
export {
  listConsolidacaoForSessao,
  countPendingConsolidacao,
  type ConsolidacaoListItem,
} from "./consolidacao/queries";
export {
  getKanbanPayload,
  listRecentSessoes,
  type KanbanCard,
  type KanbanPayload,
} from "./prestacao/kanban";
export { updateMovimentacaoStatus } from "./prestacao/status";
export {
  assignPessoaToMovimentacao,
  getMovimentacaoDetalhe,
  reprocessarIaMovimentacao,
  type AssignPessoaInput,
  type MovimentacaoDetalhe,
} from "./prestacao/movimentacao-review";
export {
  VALID_UFS,
  isPlaceholderCnpjPrestador,
  isValidUf,
  type UfSigla,
} from "./prestacao/constants";
export {
  getDiretorioEstadualByUf,
  importDiretoriosEstaduais,
  listDiretoriosEstaduais,
  updateDiretorioEstadualById,
  upsertDiretorioEstadualByUf,
  type DiretorioEstadualInput,
  type ImportEstadualRow,
} from "./prestacao/estadual";
export {
  importDiretoriosMunicipais,
  listDiretoriosMunicipais,
  updateDiretorioMunicipalById,
  upsertDiretorioMunicipal,
  type DiretorioMunicipalInput,
  type ImportMunicipalRow,
} from "./prestacao/municipal";
export { parseExcel } from "./ingest/excel";
export {
  ingestPdf,
  ingestPdfExtrato,
  rowFromExtraction,
  rowsFromExtratoTransactions,
  type IngestPdfExtratoResult,
} from "./ingest/pdf";
export { extractPdfText, MAX_EXTRATO_PAGES, MIN_TEXT_CHARS } from "./ingest/pdf-text";
export { computeHashMovimento, parseOfx, persistTransactions } from "./ingest/ofx";
export {
  INGEST_EXTENSIONS,
  fileHash,
  getDiretorio,
  ingestFile,
  ingestFileBuffer,
  ingestPath,
  parseIngestFile,
  resolveIngestPaths,
  storeUpload,
  type IngestBufferParams,
  type IngestBufferResult,
  type IngestFileParams,
} from "./ingest/pipeline";
export { storeIngestBuffer } from "./storage/store-buffer";
export {
  ARQUIVO_INGESTAO_STATUS,
  MOVIMENTACAO_DIRECAO,
  MOVIMENTACAO_STATUS,
  TIPO_PRESTADOR,
  type IngestRow,
  type PrestadorContext,
  type MovimentacaoDirecao,
  type ParsedTransactionRow,
} from "./ingest/types";
export {
  applyDeterministicMatch,
  extractDocumentCandidates,
  type ApplyDeterministicMatchOptions,
} from "./match/rules";
export {
  evaluateMovimentacaoWithAi,
  type AiMatchResult,
  type EvaluateAiMatchInput,
} from "./match/ai";
export {
  applyAiMatchToMovimentacao,
  type ApplyAiMatchOptions,
} from "./match/apply-ai";
export {
  generatePendenciasCsv,
  generatePendenciasCsvByPrestador,
  CSV_COLUMNS,
} from "./report/pendencias";
export {
  getSystemStats,
  type ConfiancaFaixas,
  type SystemStats,
  type SystemStatsGlobal,
  type SystemStatsScope,
} from "./report/system-stats";
export { normalizeCnpj, normalizeCpf, normalizeName } from "./normalize";
export {
  CADASTRO_TIPO,
  countPessoaMovimentacoes,
  deletePessoas,
  extractSpreadsheetHeaders,
  getPessoa,
  importCadastroBatch,
  listCadastroConflitos,
  listPessoaMovimentacoes,
  parseCadastroColumnMap,
  parseCadastroSpreadsheet,
  rematchPendingMovimentacoes,
  resolveCadastroConflito,
  searchPessoas,
  suggestCadastroColumnMap,
  upsertPessoa,
  type CadastroColumnMap,
  type CadastroRow,
  type CadastroTipo,
  type DeletePessoasResult,
  type DeletePessoasSkipped,
  type PessoaRef,
  type ConflitoResolucao,
  type ImportCadastroResult,
  type SpreadsheetHeadersResult,
  type UpsertPessoaContext,
} from "./cadastro";

export const CORE_PACKAGE = "@spc-up/core";
