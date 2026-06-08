import type { ExtratoColumnMap } from "../ingest/extrato-column-map";

export interface ExtractStructuredOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
  filename?: string;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** When true, bypass OpenRouter disk cache (retry / force reprocess). */
  skipCache?: boolean;
  /** Operator column layout hint for extrato extraction (wizard). */
  extratoColumnMap?: ExtratoColumnMap;
}

export interface ExtratoExtraction {
  transacoes: Array<Record<string, unknown>>;
}

export type LinhaScoreResult = { score: number; motivo: string };
