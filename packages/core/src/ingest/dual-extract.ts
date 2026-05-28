import type { ExtratoExtraction, ExtractStructuredOptions } from "../ai/openrouter";
import {
  extractTransactionsFromImagePng,
  extractTransactionsFromPdfText,
  parseExtratoValor,
  resolveExtratoModel,
  resolveReviewerExtratoModel,
  resolveSecondaryExtratoModel,
  scoreExtratoLinhas,
} from "../ai/openrouter";
import { MAX_EXTRATO_TEXT_CHARS } from "../ai/openrouter";

export const INGESTAO_PAGINA_STATUS = {
  OK: "OK",
  NAO_TRANSACIONAL: "NAO_TRANSACIONAL",
  VERIFICAR: "VERIFICAR",
  ERRO: "ERRO",
} as const;

export type IngestaoPaginaStatus =
  (typeof INGESTAO_PAGINA_STATUS)[keyof typeof INGESTAO_PAGINA_STATUS];

export type DualExtractModo = "texto" | "imagem";

export type DualExtractCandidate = {
  item: Record<string, unknown>;
  score: number;
  consenso: boolean;
  modeloOrigem: "consenso" | "primario" | "secundario" | "revisor";
  motivo?: string;
};

export type DualExtractPageResult = {
  statusPagina: IngestaoPaginaStatus;
  modo: DualExtractModo;
  aceitas: DualExtractCandidate[];
  pendentes: Array<{
    item: Record<string, unknown>;
    score: number;
    motivo: string;
    snapshot?: { primario?: Record<string, unknown>; secundario?: Record<string, unknown> };
  }>;
  textoAmostra: string;
  motivo?: string;
  primaryCount: number;
  secondaryCount: number;
};

const NON_TRANSACTIONAL_KEYWORDS =
  /\b(saldo|total|resumo|extrato emitido|período|periodo|agência|agencia|conta corrente|tarifa)\b/i;

export function resolveScoreThreshold(): number {
  const raw = process.env.INGEST_SCORE_THRESHOLD;
  if (raw == null || raw.trim() === "") {
    return 80;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 80;
}

export function resolveNonTransactionalMinChars(): number {
  const raw = process.env.INGEST_NON_TRANSACTIONAL_MIN_CHARS;
  if (raw == null || raw.trim() === "") {
    return 50;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

export function transactionConsensusKey(item: Record<string, unknown>): string | null {
  const data = String(item.data ?? "").trim();
  const direcao = String(item.direcao ?? "").trim().toUpperCase();
  const valor = parseExtratoValor(item.valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return null;
  }
  if (direcao !== "ENTRADA" && direcao !== "SAIDA") {
    return null;
  }
  if (Number.isNaN(valor)) {
    return null;
  }
  const cents = Math.round(Math.abs(valor) * 100);
  return `${data}|${cents}|${direcao}`;
}

function indexByKey(
  items: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const key = transactionConsensusKey(item);
    if (key && !map.has(key)) {
      map.set(key, item);
    }
  }
  return map;
}

export type DualDivergente = {
  indice: number;
  item: Record<string, unknown>;
  snapshot: { primario?: Record<string, unknown>; secundario?: Record<string, unknown> };
  origem: "primario" | "secundario";
};

/** Split primary/secondary extractions into consensus matches and divergent lines. */
export function partitionDualTransactions(
  primaryItems: Array<Record<string, unknown>>,
  secondaryItems: Array<Record<string, unknown>>,
): { consenso: DualExtractCandidate[]; divergentes: DualDivergente[] } {
  const mapA = indexByKey(primaryItems);
  const mapB = indexByKey(secondaryItems);
  const consenso: DualExtractCandidate[] = [];
  const divergentes: DualDivergente[] = [];

  for (const [key, itemA] of mapA) {
    const itemB = mapB.get(key);
    if (itemB) {
      consenso.push({
        item: mergeConsensusItem(itemA, itemB),
        score: 100,
        consenso: true,
        modeloOrigem: "consenso",
      });
      mapB.delete(key);
      continue;
    }
    divergentes.push({
      indice: divergentes.length,
      item: itemA,
      snapshot: { primario: itemA },
      origem: "primario",
    });
  }

  for (const [, itemB] of mapB) {
    divergentes.push({
      indice: divergentes.length,
      item: itemB,
      snapshot: { secundario: itemB },
      origem: "secundario",
    });
  }

  return { consenso, divergentes };
}

function mergeConsensusItem(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...a };
  const nomeA = String(a.nome ?? a.descricao ?? "").trim();
  const nomeB = String(b.nome ?? b.descricao ?? "").trim();
  if (nomeB.length > nomeA.length) {
    out.nome = b.nome ?? b.descricao;
  }
  if (!out.cpf && b.cpf) {
    out.cpf = b.cpf;
  }
  if (!out.cnpj && b.cnpj) {
    out.cnpj = b.cnpj;
  }
  return out;
}

export function isNonTransactionalPage(
  text: string,
  primaryCount: number,
  secondaryCount: number,
): boolean {
  if (primaryCount > 0 || secondaryCount > 0) {
    return false;
  }
  const trimmed = text.trim();
  if (trimmed.length < resolveNonTransactionalMinChars()) {
    return true;
  }
  return NON_TRANSACTIONAL_KEYWORDS.test(trimmed);
}

export type DualExtractPageInput = {
  pageBuffer: Buffer;
  pngBuffer?: Buffer;
  text: string;
  hasEnoughText: boolean;
  filename: string;
  page1Based: number;
  options?: ExtractStructuredOptions;
};

/** Run dual-model extraction + consensus + reviewer scoring for one page. */
export async function dualExtractPage(
  input: DualExtractPageInput,
): Promise<DualExtractPageResult> {
  const { pageBuffer, text, hasEnoughText, filename, page1Based, options } = input;
  const primaryModel = resolveExtratoModel(options);
  const secondaryModel = resolveSecondaryExtratoModel();
  const modo: DualExtractModo = hasEnoughText ? "texto" : "imagem";
  const textoAmostra = text.trim().slice(0, 500);

  const extractOpts = { ...options, filename, skipCache: options?.skipCache };

  let primaryExtraction: ExtratoExtraction;
  let secondaryExtraction: ExtratoExtraction;

  if (modo === "texto") {
    [primaryExtraction, secondaryExtraction] = await Promise.all([
      extractTransactionsFromPdfText(text, { ...extractOpts, model: primaryModel }),
      extractTransactionsFromPdfText(text, { ...extractOpts, model: secondaryModel }),
    ]);
  } else {
    const png = input.pngBuffer ?? pageBuffer;
    const imageName = filename.replace(/\.pdf$/i, `_p${page1Based}.png`);
    [primaryExtraction, secondaryExtraction] = await Promise.all([
      extractTransactionsFromImagePng(png, {
        ...extractOpts,
        model: primaryModel,
        filename: imageName,
      }),
      extractTransactionsFromImagePng(png, {
        ...extractOpts,
        model: secondaryModel,
        filename: imageName,
      }),
    ]);
  }

  const primaryCount = primaryExtraction.transacoes.length;
  const secondaryCount = secondaryExtraction.transacoes.length;

  if (isNonTransactionalPage(text, primaryCount, secondaryCount)) {
    return {
      statusPagina: INGESTAO_PAGINA_STATUS.NAO_TRANSACIONAL,
      modo,
      aceitas: [],
      pendentes: [],
      textoAmostra,
      motivo: "Página classificada como não transacional (rodapé/saldo ou sem conteúdo).",
      primaryCount,
      secondaryCount,
    };
  }

  if (primaryCount === 0 && secondaryCount === 0) {
    return {
      statusPagina: INGESTAO_PAGINA_STATUS.VERIFICAR,
      modo,
      aceitas: [],
      pendentes: [],
      textoAmostra,
      motivo: "Nenhuma transação extraída pelos dois modelos.",
      primaryCount,
      secondaryCount,
    };
  }

  const { consenso: aceitasConsenso, divergentes } = partitionDualTransactions(
    primaryExtraction.transacoes,
    secondaryExtraction.transacoes,
  );
  const aceitas: DualExtractCandidate[] = [...aceitasConsenso];

  const threshold = resolveScoreThreshold();
  const pendentes: DualExtractPageResult["pendentes"] = [];

  if (divergentes.length > 0) {
    const scores = await scoreExtratoLinhas(
      textoAmostra || text.slice(0, MAX_EXTRATO_TEXT_CHARS),
      divergentes.map((d) => d.item),
      { model: resolveReviewerExtratoModel(), ...options },
    );

    for (let i = 0; i < divergentes.length; i += 1) {
      const div = divergentes[i]!;
      const scored = scores[i] ?? { score: 0, motivo: "Sem score do revisor" };
      if (scored.score >= threshold) {
        aceitas.push({
          item: div.item,
          score: scored.score,
          consenso: false,
          modeloOrigem: "revisor",
          motivo: scored.motivo,
        });
      } else {
        pendentes.push({
          item: div.item,
          score: scored.score,
          motivo: scored.motivo || "SCORE_BAIXO",
          snapshot: div.snapshot,
        });
      }
    }
  }

  const statusPagina: IngestaoPaginaStatus =
    pendentes.length > 0
      ? INGESTAO_PAGINA_STATUS.VERIFICAR
      : aceitas.length > 0
        ? INGESTAO_PAGINA_STATUS.OK
        : INGESTAO_PAGINA_STATUS.VERIFICAR;

  return {
    statusPagina,
    modo,
    aceitas,
    pendentes,
    textoAmostra,
    primaryCount,
    secondaryCount,
  };
}
