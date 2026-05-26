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
export { canExport } from "./export/guard";
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
export { extractStructuredFromPdf, type ExtractStructuredOptions } from "./ai/openrouter";
export { parseExcel } from "./ingest/excel";
export { ingestPdf, rowFromExtraction } from "./ingest/pdf";
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
  type IngestFileParams,
} from "./ingest/pipeline";
export {
  ARQUIVO_INGESTAO_STATUS,
  MOVIMENTACAO_DIRECAO,
  MOVIMENTACAO_STATUS,
  type IngestRow,
  type MovimentacaoDirecao,
  type ParsedTransactionRow,
} from "./ingest/types";
export {
  applyDeterministicMatch,
  extractDocumentCandidates,
  type ApplyDeterministicMatchOptions,
} from "./match/rules";
export { generatePendenciasCsv, CSV_COLUMNS } from "./report/pendencias";
export { normalizeCnpj, normalizeCpf, normalizeName } from "./normalize";
export {
  CADASTRO_TIPO,
  countPessoaMovimentacoes,
  getPessoa,
  importCadastroBatch,
  listCadastroConflitos,
  listPessoaMovimentacoes,
  parseCadastroSpreadsheet,
  rematchPendingMovimentacoes,
  resolveCadastroConflito,
  searchPessoas,
  upsertPessoa,
  type CadastroRow,
  type CadastroTipo,
  type ConflitoResolucao,
  type ImportCadastroResult,
  type UpsertPessoaContext,
} from "./cadastro";

export const CORE_PACKAGE = "@spc-up/core";
