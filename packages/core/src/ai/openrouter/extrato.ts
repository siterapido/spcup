import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveModelProfile } from "../model-profile";
import {
  readExtratoPdfCache,
  readExtratoTextCache,
  writeExtratoPdfCache,
  writeExtratoTextCache,
} from "../openrouter-cache";
import type { ExtractStructuredOptions, ExtratoExtraction, LinhaScoreResult } from "../openrouter-types";
import { MIN_TEXT_CHARS } from "../../ingest/pdf-text";
import {
  dedupeExtratoTransactions,
  getPdfPageCount,
  shouldBatchPdfVision,
  splitPdfIntoBatches,
} from "../../ingest/pdf-split";
import { callOpenRouterJson, resolvePdfTimeoutMs, withMaxTokens, withScoreMaxTokens } from "./client";
import {
  resolveExtratoModel,
  resolveMatchModel,
  resolveReviewerExtratoModel,
} from "./models";
import {
  buildExtratoFilePayload,
  buildExtratoImagePayload,
  buildExtratoTextPayload,
  buildPayload,
  buildStructuredResponseFormat,
  LINHA_SCORE_SCHEMA,
  MAX_EXTRATO_TEXT_CHARS,
  trimExtratoText,
} from "./schemas";

export { MAX_EXTRATO_TEXT_CHARS };

async function resolvePdfInput(
  pathOrBuffer: string | Buffer,
  filename?: string,
): Promise<{ buffer: Buffer; filename: string }> {
  if (Buffer.isBuffer(pathOrBuffer)) {
    return {
      buffer: pathOrBuffer,
      filename: filename ?? "document.pdf",
    };
  }

  const resolved = path.resolve(pathOrBuffer);
  const info = await stat(resolved);
  if (!info.isFile()) {
    throw new Error(`PDF not found: ${resolved}`);
  }

  return {
    buffer: await readFile(resolved),
    filename: filename ?? path.basename(resolved),
  };
}

export function parseExtratoValor(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return Number.NaN;
  }
  const normalized = raw.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized);
}

const SHORT_BANK_CODE = /^[A-Z0-9][A-Z0-9\s.\-/]{2,14}$/;

function inferNomeFromDescricao(descricao: string): string | undefined {
  const text = descricao.trim();
  if (text.length < 8) {
    return undefined;
  }
  if (SHORT_BANK_CODE.test(text)) {
    return undefined;
  }
  return text;
}

function normalizeExtratoItem(item: Record<string, unknown>): Record<string, unknown> {
  const out = { ...item };
  const contraparte = String(out.contraparte ?? "").trim();
  const nome = String(out.nome ?? "").trim();
  if (!nome && contraparte) {
    out.nome = contraparte;
  }

  const nomeStr = String(out.nome ?? "").trim();
  const descricaoStr = String(out.descricao ?? "").trim();
  if (!nomeStr && descricaoStr) {
    const inferred = inferNomeFromDescricao(descricaoStr);
    if (inferred) {
      out.nome = inferred;
    }
  }

  let credDev = String(out.cred_dev ?? out.credDev ?? "")
    .trim()
    .replace(/^null$/i, "");
  if (!credDev && descricaoStr && SHORT_BANK_CODE.test(descricaoStr)) {
    credDev = descricaoStr;
  }
  if (credDev) {
    out.cred_dev = credDev;
  }

  const docRaw = String(out.cpf_cnpj ?? "").replace(/\D/g, "");
  if (!out.cpf && docRaw.length === 11) {
    out.cpf = docRaw;
  } else if (!out.cnpj && docRaw.length === 14) {
    out.cnpj = docRaw;
  }

  const valor = parseExtratoValor(out.valor);
  if (Number.isFinite(valor)) {
    out.valor = valor;
  }

  return out;
}

function normalizeExtratoResponse(parsed: Record<string, unknown>): ExtratoExtraction {
  const raw = parsed.transacoes;
  if (!Array.isArray(raw)) {
    return { transacoes: [] };
  }

  return {
    transacoes: raw.map((item) =>
      typeof item === "object" && item !== null && !Array.isArray(item)
        ? normalizeExtratoItem(item as Record<string, unknown>)
        : {},
    ),
  };
}

export async function extractStructuredFromPdf(
  pathOrBuffer: string | Buffer,
  options?: ExtractStructuredOptions,
): Promise<Record<string, unknown>> {
  const model = resolveExtratoModel(options);
  const { buffer, filename } = await resolvePdfInput(pathOrBuffer, options?.filename);
  const payload = buildPayload(buffer, filename, model);
  const { parsed } = await callOpenRouterJson(payload, options);
  return parsed;
}

export async function extractTransactionsFromPdfText(
  statementText: string,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  const normalized = trimExtratoText(statementText);
  if (!options?.skipCache) {
    const cached = await readExtratoTextCache(normalized, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoTextPayload(normalized, model, options);
  const { parsed } = await callOpenRouterJson(payload, options);
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoTextCache(normalized, model, extraction);
  return extraction;
}

export async function extractTransactionsFromImagePng(
  pngBuffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  if (!options?.skipCache) {
    const cached = await readExtratoPdfCache(pngBuffer, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoImagePayload(
    pngBuffer,
    options?.filename ?? "page.png",
    model,
    options,
  );
  const { parsed } = await callOpenRouterJson(payload, {
    ...options,
    timeoutMs: options?.timeoutMs ?? resolvePdfTimeoutMs(),
  });
  const extraction = normalizeExtratoResponse(parsed);
  await writeExtratoPdfCache(pngBuffer, model, extraction);
  return extraction;
}

export async function scoreExtratoLinhas(
  pageText: string,
  items: Array<Record<string, unknown>>,
  options?: ExtractStructuredOptions,
): Promise<LinhaScoreResult[]> {
  if (items.length === 0) {
    return [];
  }

  const model = options?.model ?? resolveReviewerExtratoModel();
  const linesJson = JSON.stringify(
    items.map((item, indice) => ({ indice, ...item })),
    null,
    0,
  );

  const payload = withScoreMaxTokens({
    model,
    messages: [
      {
        role: "system",
        content:
          "You validate bank statement transaction rows extracted from OCR. " +
          "Return a score 0-100 per line: how likely the row is a real transaction " +
          "with correct date, amount, and direction given the page text.",
      },
      {
        role: "user",
        content:
          "Page text sample:\n---\n" +
          pageText.slice(0, 1500) +
          "\n---\n\nCandidate rows:\n" +
          linesJson,
      },
    ],
    response_format: buildStructuredResponseFormat(
      model,
      "linha_scores",
      LINHA_SCORE_SCHEMA as unknown as Record<string, unknown>,
    ),
  });

  const { parsed } = await callOpenRouterJson(payload, options);
  const rawLinhas = parsed.linhas;
  const byIndex = new Map<number, LinhaScoreResult>();

  if (Array.isArray(rawLinhas)) {
    for (const entry of rawLinhas) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const indice = Number(row.indice);
      const score = Number(row.score);
      if (!Number.isInteger(indice) || indice < 0 || indice >= items.length) {
        continue;
      }
      const clamped = Number.isFinite(score)
        ? Math.min(100, Math.max(0, Math.round(score)))
        : 0;
      byIndex.set(indice, {
        score: clamped,
        motivo: String(row.motivo ?? "").trim() || "Revisor",
      });
    }
  }

  return items.map((_, indice) =>
    byIndex.get(indice) ?? { score: 0, motivo: "Sem score do revisor" },
  );
}

async function extractTransactionsFromSinglePdfBuffer(
  buffer: Buffer,
  options: ExtractStructuredOptions | undefined,
  model: string,
  filename: string,
): Promise<ExtratoExtraction> {
  if (!options?.skipCache) {
    const cached = await readExtratoPdfCache(buffer, model);
    if (cached) {
      return cached;
    }
  }

  const payload = buildExtratoFilePayload(buffer, filename, model, options);
  const { parsed, fileOcrText } = await callOpenRouterJson(payload, {
    ...options,
    timeoutMs: options?.timeoutMs ?? resolvePdfTimeoutMs(),
  });
  let extraction = normalizeExtratoResponse(parsed);

  const profile = resolveModelProfile(model);
  const ocrText = fileOcrText.trim();
  if (
    profile.ocrTextFallback &&
    extraction.transacoes.length === 0 &&
    ocrText.length >= MIN_TEXT_CHARS
  ) {
    extraction = await extractTransactionsFromPdfText(ocrText, {
      ...options,
      model,
      filename,
    });
  }

  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}

export async function extractTransactionsFromPdfFile(
  buffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const model = resolveExtratoModel(options);
  if (!options?.skipCache) {
    const fullCached = await readExtratoPdfCache(buffer, model);
    if (fullCached) {
      return fullCached;
    }
  }

  const baseName = options?.filename ?? "document.pdf";
  const pageCount = await getPdfPageCount(buffer);
  const useBatches = shouldBatchPdfVision(buffer, pageCount, model);

  if (!useBatches) {
    return extractTransactionsFromSinglePdfBuffer(buffer, options, model, baseName);
  }

  const batches = await splitPdfIntoBatches(buffer);
  const merged: Array<Record<string, unknown>> = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batchBuffer = batches[index]!;
    const batchName =
      batches.length === 1
        ? baseName
        : `${baseName.replace(/\.pdf$/i, "")}_p${index + 1}.pdf`;

    const part = await extractTransactionsFromSinglePdfBuffer(
      batchBuffer,
      options,
      model,
      batchName,
    );
    const batchPagina = index + 1;
    for (const tx of part.transacoes) {
      tx.__batch_pagina = batchPagina;
    }
    merged.push(...part.transacoes);
  }

  const extraction: ExtratoExtraction = {
    transacoes: dedupeExtratoTransactions(merged),
  };
  await writeExtratoPdfCache(buffer, model, extraction);
  return extraction;
}

export async function runConsolidacaoCritique(
  drafts: any[],
  cadastros: { pfs: any[]; pjs: any[] },
  sessaoCtx: { uf: string; exercicio: number },
  options?: ExtractStructuredOptions,
): Promise<any[]> {
  if (drafts.length === 0) {
    return drafts;
  }

  const primaryModel = options?.model ?? resolveExtratoModel(options);
  const promptPrimary = `
Você é o modelo de IA primário responsável por analisar lançamentos de extratos bancários de uma prestação de contas eleitoral (${sessaoCtx.uf} / ${sessaoCtx.exercicio}) e encontrar possíveis vínculos com as pessoas físicas (PF) ou jurídicas (PJ) cadastradas no sistema.

Cadastros de Pessoas:
PFs: ${JSON.stringify(cadastros.pfs.map((p) => ({ id: p.id, nome: p.nome, cpf: p.cpf })))}
PJs: ${JSON.stringify(cadastros.pjs.map((p) => ({ id: p.id, nome: p.nome, cnpj: p.cnpj })))}

Eventos Candidatos a Consolidação:
${JSON.stringify(
    drafts.map((d, index) => ({
      index,
      dataMovimento: d.dataMovimento,
      valor: d.valor,
      direcao: d.direcao,
      linhas: d.linhas.map((l: any) => ({ papel: l.papel, descricaoRaw: l.descricaoRaw })),
    })),
  )}

Instruções:
1. Examine as descrições brutas (descricaoRaw) de cada candidato.
2. Identifique se a pessoa mencionada na transação corresponde a algum cadastro (PF ou PJ). Use lógica de similaridade de nome: ignore diferenças de caixa (Caps Lock), acentuação, preposições ("de", "da", "dos", etc.) e abreviações de nomes do meio (focando no primeiro nome e no último sobrenome).
3. Se houver homônimos (nomes iguais ou muito similares) com o mesmo valor, ou qualquer ambiguidade, não faça o vínculo automaticamente; marque para avaliação do revisor.
4. Para cada candidato, proponha o melhor match, se houver.
5. Sua resposta DEVE ser um objeto JSON no seguinte formato:
{
  "propostas": [
    {
      "index": 0,
      "pessoaFisicaId": "id-do-cadastro-ou-null-ou-vazio",
      "pessoaJuridicaId": "id-do-cadastro-ou-null-ou-vazio",
      "justificativa": "Sua explicação detalhada do match"
    }
  ]
}
`;

  const primaryPayload = withMaxTokens({
    model: primaryModel,
    messages: [
      {
        role: "system",
        content:
          "Você é um assistente especialista em conciliação contábil que extrai e sugere correspondências em formato JSON estruturado.",
      },
      {
        role: "user",
        content: promptPrimary,
      },
    ],
    response_format: { type: "json_object" },
  });

  let sugestoesPrimarias: any = { propostas: [] };
  try {
    const { parsed } = await callOpenRouterJson(primaryPayload, options);
    sugestoesPrimarias = parsed;
  } catch (err) {
    console.error("Erro no modelo primário durante a consolidação AI:", err);
  }

  const reviewerModel = resolveReviewerExtratoModel();
  const promptReviewer = `
Você é o modelo revisor/avaliador crítico de contabilidade eleitoral (via OpenRouter, Gemini).
Sua missão é avaliar rigorosamente as propostas de match entre lançamentos bancários e pessoas cadastradas (PF/PJ) geradas pelo modelo primário.
Evite a todo custo matches incorretos (falsos positivos) que possam invalidar a prestação de contas oficial.

Cadastros de Pessoas:
PFs: ${JSON.stringify(cadastros.pfs.map((p) => ({ id: p.id, nome: p.nome, cpf: p.cpf })))}
PJs: ${JSON.stringify(cadastros.pjs.map((p) => ({ id: p.id, nome: p.nome, cnpj: p.cnpj })))}

Eventos Candidatos a Consolidação:
${JSON.stringify(
    drafts.map((d, index) => ({
      index,
      dataMovimento: d.dataMovimento,
      valor: d.valor,
      direcao: d.direcao,
      linhas: d.linhas.map((l: any) => ({ papel: l.papel, descricaoRaw: l.descricaoRaw })),
    })),
  )}

Sugestões do Modelo Primário:
${JSON.stringify(sugestoesPrimarias, null, 2)}

Instruções para a Crítica:
1. Para cada evento, analise as sugestões do modelo primário. Se o match for forçado ou incorreto, você DEVE rejeitá-lo (retornando vazio ou null para os IDs).
2. Use similaridade de nome rigorosa (ignore acentos, caixa, preposições e abreviações).
3. Se houver homônimos (nomes parecidos) com o mesmo valor, ou se a semelhança for fraca/duvidosa, atribua uma nota de confiança baixa (abaixo de 0.65) e explique o motivo na justificativa. Isso colocará o item em análise manual pelo operador.
4. Defina uma nota final de confiança (de 0.00 a 1.00) com base na solidez do match:
   - 0.90 a 0.95: CPF/CNPJ ou nome idêntico e único.
   - 0.70 a 0.85: Nome com abreviações óbvias, e valor correspondente.
   - 0.40 a 0.65: Indícios mas sem certeza absoluta (match duvidoso/homônimo).
   - Abaixo de 0.40: Sem vínculo seguro.
5. Escreva uma justificativa final clara e direta baseada na sua crítica (ex: "Match aprovado pelo revisor: GABRIEL R SILVA coincide com GABRIEL REIS DA SILVA", ou "Divergência/homônimo: match marcado como duvidoso para verificação humana").
6. Sua resposta DEVE ser um objeto JSON contendo o array 'eventos'.
`;

  const REVISOR_SCHEMA = {
    type: "object",
    properties: {
      eventos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            confianca: { type: "number" },
            justificativa: { type: "string" },
            pessoaFisicaId: {
              type: "string",
              description: "ID de Pessoa Física ou vazio se não houver match",
            },
            pessoaJuridicaId: {
              type: "string",
              description: "ID de Pessoa Jurídica ou vazio se não houver match",
            },
          },
          required: ["index", "confianca", "justificativa"],
        },
      },
    },
    required: ["eventos"],
  };

  const reviewerPayload = withMaxTokens({
    model: reviewerModel,
    messages: [
      {
        role: "system",
        content:
          "Você é um revisor crítico de conciliação bancária eleitoral que valida propostas de correspondência em formato JSON estruturado.",
      },
      {
        role: "user",
        content: promptReviewer,
      },
    ],
    response_format: buildStructuredResponseFormat(
      reviewerModel,
      "critique_match",
      REVISOR_SCHEMA as unknown as Record<string, unknown>,
    ),
  });

  try {
    const { parsed } = await callOpenRouterJson(reviewerPayload, options);
    const rawEventos = parsed.eventos;
    if (Array.isArray(rawEventos)) {
      for (const entry of rawEventos) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const row = entry as Record<string, unknown>;
        const index = Number(row.index);
        if (!Number.isInteger(index) || index < 0 || index >= drafts.length) {
          continue;
        }
        const target = drafts[index]!;
        const confianca = Number(row.confianca);
        target.confianca = Number.isFinite(confianca)
          ? Math.min(1, Math.max(0, confianca))
          : target.confianca;
        target.justificativa =
          String(row.justificativa ?? "").trim() || target.justificativa;

        const pfId = String(row.pessoaFisicaId ?? "").trim();
        const pjId = String(row.pessoaJuridicaId ?? "").trim();

        if (pfId && pfId.toLowerCase() !== "null" && pfId.toLowerCase() !== "undefined") {
          target.pessoaFisicaId = pfId;
          delete target.pessoaJuridicaId;
        } else if (pjId && pjId.toLowerCase() !== "null" && pjId.toLowerCase() !== "undefined") {
          target.pessoaJuridicaId = pjId;
          delete target.pessoaFisicaId;
        } else {
          delete target.pessoaFisicaId;
          delete target.pessoaJuridicaId;
        }
      }
    }
  } catch (err) {
    console.error("Erro no modelo revisor durante a consolidação AI:", err);
  }

  return drafts;
}
