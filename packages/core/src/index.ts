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
  type ExtratoExtraction,
  type ExtractStructuredOptions,
} from "./ai/openrouter";
export {
  createSessao,
  getSessao,
  prestadorFromSessao,
  resolveCnpjPrestador,
  type CreateSessaoInput,
  type PrestadorResolvido,
} from "./prestacao/sessao";
export {
  getKanbanPayload,
  listRecentSessoes,
  type KanbanCard,
  type KanbanPayload,
} from "./prestacao/kanban";
export { updateMovimentacaoStatus } from "./prestacao/status";
export {
  importDiretoriosMunicipais,
  listDiretoriosMunicipais,
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
export { normalizeCnpj, normalizeCpf, normalizeName } from "./normalize";
export {
  CADASTRO_TIPO,
  countPessoaMovimentacoes,
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
  type ConflitoResolucao,
  type ImportCadastroResult,
  type SpreadsheetHeadersResult,
  type UpsertPessoaContext,
} from "./cadastro";

export const CORE_PACKAGE = "@spc-up/core";
