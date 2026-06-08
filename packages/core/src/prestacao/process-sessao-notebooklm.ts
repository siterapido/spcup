import {
  arquivoIngestao,
  INGESTAO_PAGINA_STATUS,
  movimentacao,
  movimentacaoSpca,
  pessoaFisica,
  pessoaJuridica,
  type Db,
} from "@spc-up/db";
import { eq, and, inArray } from "drizzle-orm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  getOrCreateNotebook,
  syncCandidateFolder,
  syncRulesFolder,
  uploadFileToNotebook,
  queryNotebook,
  deleteSource,
  listSources,
} from "../ai/notebooklm";
import { upsertPessoa } from "../cadastro/upsert";
import { consolidateSession } from "../consolidacao/run";
import {
  buildExtratoColumnPromptHint,
  type ExtratoColumnMap,
  parseExtratoColumnMap,
} from "../ingest/extrato-column-map";
import { computeHashMovimento } from "../ingest/hash";
import { upsertIngestaoPagina } from "../ingest/ingestao-pagina";
import { ARQUIVO_INGESTAO_STATUS, MOVIMENTACAO_STATUS } from "../ingest/types";
import { normalizeName } from "../normalize";
import { readArquivoIngestaoBuffer } from "../storage/read-arquivo";
import type { ProcessSessaoResult, ProcessPdfArquivoResult } from "./process-sessao";
import { getSessao, prestadorFromSessao } from "./sessao";

const BALANCE_EPSILON = 0.05;

export function notebookSourceFileName(arquivoId: string, nomeArquivo: string): string {
  return `${arquivoId}_${nomeArquivo}`;
}

export function buildNotebookLmExtratoPrompt(
  nomeArquivo: string,
  extratoColumnMap?: ExtratoColumnMap,
): string {
  const base = `Você concilia transações bancárias de prestação de contas partidária no Brasil.
Analise apenas o extrato bancário nomeado "${nomeArquivo}" neste notebook. Use os arquivos de cadastro (PF/PJ) e documentos de regras formais do SPCA/TSE contidos neste notebook para cruzamento e classificação.
Extraia todas as transações (lançamentos) de débito e crédito presentes apenas neste extrato. Não inclua transações de outros extratos bancários presentes no notebook.

Sua prioridade máxima é cruzar e identificar cada transação com os candidatos/pessoas cadastrados no arquivo "cadastro_pessoas_db.csv".
Regras de match e preenchimento de candidato:
1. Consulte ativamente o arquivo "cadastro_pessoas_db.csv" que contém as colunas (tipo, documento, nome) para buscar os candidatos do banco de dados (por aproximação de nome, aliases, trechos de nome ou correspondência de CPF/CNPJ).
2. Se houver correspondência (match) de nome ou documento com uma linha de "cadastro_pessoas_db.csv", retorne obrigatoriamente:
   - "documento_candidato": O documento exato da linha correspondente no "cadastro_pessoas_db.csv" (apenas números: 11 dígitos para CPF, 14 para CNPJ).
   - "nome_candidato": O nome exato da linha correspondente no "cadastro_pessoas_db.csv".
3. Se não houver nenhuma correspondência no arquivo "cadastro_pessoas_db.csv", procure também em outros arquivos de cadastro locais presentes no notebook.
4. Caso a transação NÃO corresponda a nenhuma pessoa em "cadastro_pessoas_db.csv" ou outros cadastros do notebook:
   - Se o extrato/descrição contiver um CPF ou CNPJ explícito, retorne esse documento em "documento_candidato" e o nome do favorecido/pagador (extraído da descrição) em "nome_candidato".
   - Se NÃO houver CPF/CNPJ explícito na descrição e nenhum match foi feito, retorne "documento_candidato" como null e "nome_candidato" como o nome do favorecido/pagador extraído da descrição (ou null caso não seja identificável).

Determine também a Fonte de Recurso, a Natureza de Recurso e o Tipo Origem do Recurso para a transação, utilizando os documentos de regras do SPCA e a tabela de códigos abaixo para maior precisão jurídica.

Tabela de Códigos SPCA para Referência:

1. Fonte de Recurso (fonte_recurso):
- FP: Fundo Partidário
- OR: Outros Recursos
- RC: Recurso de Campanha
- FEFC: Fundo Especial de Financiamento de Campanha

2. Natureza de Recurso (natureza_recurso):
- 0: Financeiro
- 1: Estimável em dinheiro

3. Tipo Origem do Recurso (tipo_origem_recurso):
- CE: Candidato/Comitê - Recursos Próprios
- CF: Candidato - Doação de Outros Candidatos / Comitês
- PF: Pessoa Física
- PJ: Pessoa Jurídica
- PP: Partido Político
- CA: Comercialização
- NI: Não Identificado

Extraia também os metadados de saldos do extrato bancário.
Retorne APENAS um objeto JSON válido (sem explicações ou marcações markdown como \`\`\`json). O objeto deve ter o seguinte formato exato:
{
  "saldo_inicial": 1000.00,
  "saldo_final": 1500.00,
  "total_debitos": 500.00,
  "total_creditos": 1000.00,
  "transacoes": [
    {
      "data": "YYYY-MM-DD",
      "valor": 1250.50,
      "direcao": "CREDITO" | "DEBITO",
      "descricao": "Descrição original da transação",
      "documento_candidato": "CPF ou CNPJ do candidato correspondente (somente números, ou null)",
      "nome_candidato": "Nome ou Razão Social do candidato correspondente (ou null)",
      "fonte_recurso": "Código da fonte de recurso (ex: 'FP', 'OR', 'RC', 'FEFC' ou null)",
      "natureza_recurso": "Código da natureza de recurso (ex: '0', '1' ou null)",
      "tipo_origem_recurso": "Código do tipo de origem do recurso (ex: 'CE', 'CF', 'PF', 'PJ', 'PP', 'CA', 'NI' ou null)"
    }
  ]
}`;
  if (!extratoColumnMap) {
    return base;
  }
  return `${base}\n\n---\n${buildExtratoColumnPromptHint(extratoColumnMap)}\n---`;
}

interface NotebookLmTx {
  data: string;
  valor: number;
  direcao: "CREDITO" | "DEBITO";
  descricao: string;
  documento_candidato: string | null;
  nome_candidato: string | null;
  fonte_recurso: string | null;
  natureza_recurso: string | null;
  tipo_origem_recurso: string | null;
}

interface NotebookLmPayload {
  saldo_inicial: number | null;
  saldo_final: number | null;
  total_debitos: number | null;
  total_creditos: number | null;
  transacoes: NotebookLmTx[];
}

interface NameCandidate {
  id: string;
  nome: string;
}

function cleanJsonResponse(response: string): string {
  let clean = response.trim();
  if (!clean.startsWith("```")) {
    return clean;
  }

  const firstNewline = clean.indexOf("\n");
  if (firstNewline !== -1) {
    clean = clean.slice(firstNewline + 1);
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3);
  }
  return clean.trim();
}

export function validateBalanceConsistency(
  payload: NotebookLmPayload,
  transactions: NotebookLmTx[],
): string[] {
  const avisos: string[] = [];
  const saldoInicial = payload.saldo_inicial ?? 0;
  const saldoFinal = payload.saldo_final ?? 0;
  const totalDebitos = payload.total_debitos ?? 0;
  const totalCreditos = payload.total_creditos ?? 0;

  const somaSaldos = saldoInicial + totalCreditos - totalDebitos;
  if (Math.abs(somaSaldos - saldoFinal) > BALANCE_EPSILON) {
    avisos.push(
      `Inconsistência de saldos no extrato: Saldo Inicial (${saldoInicial.toFixed(2)}) + Créditos (${totalCreditos.toFixed(2)}) - Débitos (${totalDebitos.toFixed(2)}) = ${somaSaldos.toFixed(2)}, mas Saldo Final informado é ${saldoFinal.toFixed(2)}.`,
    );
  }

  const somaDebitosCalculada = transactions
    .filter((t) => t.direcao === "DEBITO")
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  if (Math.abs(somaDebitosCalculada - totalDebitos) > BALANCE_EPSILON) {
    avisos.push(
      `Inconsistência de Débitos: O total de débitos extraído (${totalDebitos.toFixed(2)}) difere da soma dos débitos das transações processadas (${somaDebitosCalculada.toFixed(2)}).`,
    );
  }

  const somaCreditosCalculada = transactions
    .filter((t) => t.direcao === "CREDITO")
    .reduce((sum, t) => sum + (t.valor || 0), 0);
  if (Math.abs(somaCreditosCalculada - totalCreditos) > BALANCE_EPSILON) {
    avisos.push(
      `Inconsistência de Créditos: O total de créditos extraído (${totalCreditos.toFixed(2)}) difere da soma dos créditos das transações processadas (${somaCreditosCalculada.toFixed(2)}).`,
    );
  }

  return avisos;
}

export function buildNotebookLmIngestMetadados(
  existing: Record<string, unknown>,
  payload: NotebookLmPayload,
  transactions: NotebookLmTx[],
  created: number,
  avisosBalance: string[],
): Record<string, unknown> {
  const metadados: Record<string, unknown> = {
    ...existing,
    motor: "notebooklm",
    transacoes_extraidas: transactions.length,
    movimentacoes_persistidas: created,
    linhas_ignoradas_sem_doc: Math.max(0, transactions.length - created),
    avisos_balance: avisosBalance,
    processado_em: new Date().toISOString(),
  };

  const hasSaldos =
    payload.saldo_inicial != null ||
    payload.saldo_final != null ||
    payload.total_creditos != null ||
    payload.total_debitos != null;

  if (hasSaldos) {
    metadados.saldos = {
      saldo_inicial: payload.saldo_inicial,
      saldo_final: payload.saldo_final,
      total_creditos: payload.total_creditos,
      total_debitos: payload.total_debitos,
    };
  }

  return metadados;
}

function parseCandidateDocument(documento: string | null): { hasValidDoc: boolean; cleanedDoc: string } {
  if (!documento) {
    return { hasValidDoc: false, cleanedDoc: "" };
  }
  const cleanedDoc = documento.replace(/\D/g, "");
  const hasValidDoc = cleanedDoc.length === 11 || cleanedDoc.length === 14;
  return { hasValidDoc, cleanedDoc };
}

type PersistNotebookLmContext = {
  uf: string;
  exercicio: number;
  sessaoId: string;
  arquivoIngestaoId: string;
  prestadorBase: ReturnType<typeof prestadorFromSessao>;
};

async function persistNotebookLmTransactions(
  db: Db,
  ctx: PersistNotebookLmContext,
  transactions: NotebookLmTx[],
): Promise<number> {
  let created = 0;
  const { uf, exercicio, sessaoId, arquivoIngestaoId, prestadorBase } = ctx;

  for (let index = 0; index < transactions.length; index += 1) {
    const tx = transactions[index]!;
    let pfId: string | null = null;
    let pjId: string | null = null;

    const { hasValidDoc, cleanedDoc } = parseCandidateDocument(tx.documento_candidato);

    if (hasValidDoc && tx.nome_candidato) {
      const isPf = cleanedDoc.length === 11;
      const upsertRes = await upsertPessoa(
        db,
        {
          tipo: isPf ? "PF" : "PJ",
          documento: cleanedDoc,
          nome: tx.nome_candidato,
        },
        { uf, exercicio, origem: "IMPORT" },
      );

      if (isPf) {
        pfId = upsertRes.pessoaFisicaId || null;
      } else {
        pjId = upsertRes.pessoaJuridicaId || null;
      }
    }

    const hashInput = {
      dataMovimento: new Date(tx.data),
      valor: tx.valor.toFixed(2),
      descricaoRaw: tx.descricao,
      direcao: tx.direcao === "CREDITO" ? "ENTRADA" : "SAIDA",
    };

    const hash = computeHashMovimento(
      prestadorBase.cnpjPrestador,
      exercicio,
      hashInput,
      `${arquivoIngestaoId}|${index}`,
    );

    const [mov] = await db
      .insert(movimentacao)
      .values({
        uf,
        exercicio,
        dataMovimento: tx.data,
        valor: tx.valor.toFixed(2),
        descricaoRaw: tx.descricao,
        direcao: tx.direcao === "CREDITO" ? "ENTRADA" : "SAIDA",
        pessoaFisicaId: pfId,
        pessoaJuridicaId: pjId,
        arquivoIngestaoId,
        sessaoPrestacaoId: sessaoId,
        cnpjPrestador: prestadorBase.cnpjPrestador,
        tipoPrestador: prestadorBase.tipoPrestador,
        diretorioMunicipalId: prestadorBase.diretorioMunicipalId,
        status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
        confiancaGlobal: 0.95,
        hashMovimento: hash,
      })
      .onConflictDoNothing()
      .returning();

    if (mov) {
      created += 1;
      if (tx.fonte_recurso || tx.natureza_recurso || tx.tipo_origem_recurso) {
        await db
          .insert(movimentacaoSpca)
          .values({
            movimentacaoId: mov.id,
            fonteRecurso: tx.fonte_recurso,
            naturezaRecurso: tx.natureza_recurso,
            tipoOrigemRecurso: tx.tipo_origem_recurso,
          })
          .onConflictDoNothing();
      }
    }
  }

  return created;
}

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function syncDatabasePeopleToNotebook(
  notebookId: string,
  allPFs: NameCandidate[],
  allPJs: NameCandidate[],
): Promise<void> {
  const filename = "cadastro_pessoas_db.csv";
  const sources = await listSources(notebookId);
  const existing = sources.find((s) => s.title.trim().toLowerCase() === filename);
  if (existing) {
    await deleteSource(notebookId, existing.id);
  }

  if (allPFs.length === 0 && allPJs.length === 0) {
    return;
  }

  const header = "tipo,documento,nome\n";
  const rows = [];
  for (const pf of allPFs) {
    rows.push(`PF,${pf.cpf},${escapeCsvField(pf.nome)}`);
  }
  for (const pj of allPJs) {
    rows.push(`PJ,${pj.cnpj},${escapeCsvField(pj.nome)}`);
  }
  const csvContent = header + rows.join("\n");
  const tmpCsvPath = path.join(os.tmpdir(), filename);
  await fs.writeFile(tmpCsvPath, csvContent, "utf8");
  try {
    await uploadFileToNotebook(notebookId, tmpCsvPath);
  } finally {
    await fs.unlink(tmpCsvPath).catch(() => {});
  }
}

export type ProcessSessaoNotebookLmOptions = {
  skipConsolidacao?: boolean;
  extratoColumnMaps?: Record<string, ExtratoColumnMap>;
};

export async function processSessaoWithNotebookLM(
  db: Db,
  sessaoId: string,
  options?: ProcessSessaoNotebookLmOptions,
): Promise<ProcessSessaoResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadual) {
    throw new Error("Sessão não encontrada ou sem diretório estadual");
  }

  const { uf, exercicio } = sessao;
  const prestadorBase = prestadorFromSessao(sessao);

  const notebookId = await getOrCreateNotebook(uf, exercicio);

  const allPFs = await db
    .select({ id: pessoaFisica.id, cpf: pessoaFisica.cpf, nome: pessoaFisica.nome })
    .from(pessoaFisica);
  const allPJs = await db
    .select({ id: pessoaJuridica.id, cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
    .from(pessoaJuridica);

  await syncDatabasePeopleToNotebook(notebookId, allPFs, allPJs);
  await syncCandidateFolder(notebookId, uf, exercicio);
  await syncRulesFolder(notebookId);

  const pendingRows = await db
    .select()
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
        inArray(arquivoIngestao.status, [
          ARQUIVO_INGESTAO_STATUS.PENDENTE,
          ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
        ]),
      ),
    );

  const pendingFiles = pendingRows.filter((r) => /\.pdf$/i.test(r.nomeArquivo));

  const arquivosResult: ProcessPdfArquivoResult[] = [];
  let totalMovs = 0;

  for (const arq of pendingFiles) {
    try {
      await db
        .update(arquivoIngestao)
        .set({ status: ARQUIVO_INGESTAO_STATUS.PROCESSANDO })
        .where(eq(arquivoIngestao.id, arq.id));

      const buffer = await readArquivoIngestaoBuffer(arq.caminhoStorage);
      const tmpPath = path.join(os.tmpdir(), notebookSourceFileName(arq.id, arq.nomeArquivo));
      await fs.writeFile(tmpPath, buffer);

      try {
        await uploadFileToNotebook(notebookId, tmpPath);
      } finally {
        await fs.unlink(tmpPath).catch(() => {});
      }

      arquivosResult.push({
        arquivoId: arq.id,
        nome: arq.nomeArquivo,
        paginas: [],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      arquivosResult.push({
        arquivoId: arq.id,
        nome: arq.nomeArquivo,
        paginas: [],
        erro: message,
      });
      await db
        .update(arquivoIngestao)
        .set({
          status: ARQUIVO_INGESTAO_STATUS.ERRO,
          erroMensagem: message,
        })
        .where(eq(arquivoIngestao.id, arq.id));
    }
  }

  const processedSucessfully = arquivosResult.filter((a) => !a.erro);
  const avisos: string[] = [];

  if (processedSucessfully.length > 0) {
    const persistCtxBase = {
      uf,
      exercicio,
      sessaoId,
      prestadorBase,
    };

    const pendingById = new Map(pendingRows.map((r) => [r.id, r]));

    for (const arq of processedSucessfully) {
      try {
        const rawMap = options?.extratoColumnMaps?.[arq.arquivoId];
        const columnMap = rawMap ? parseExtratoColumnMap(rawMap) ?? rawMap : undefined;

        if (columnMap) {
          const existingRow = pendingById.get(arq.arquivoId);
          const existingMetadados =
            existingRow?.metadados != null && typeof existingRow.metadados === "object"
              ? (existingRow.metadados as Record<string, unknown>)
              : {};
          await db
            .update(arquivoIngestao)
            .set({
              metadados: { ...existingMetadados, extratoColumnMap: columnMap },
            })
            .where(eq(arquivoIngestao.id, arq.arquivoId));
        }

        const res = await queryNotebook(
          notebookId,
          buildNotebookLmExtratoPrompt(
            notebookSourceFileName(arq.arquivoId, arq.nome),
            columnMap,
          ),
        );
        const cleanJson = cleanJsonResponse(res.answer);

        let payload: NotebookLmPayload;
        try {
          payload = JSON.parse(cleanJson);
        } catch (parseErr) {
          throw new Error(
            `Failed to parse NotebookLM query output for ${arq.nome}: ${parseErr}\nResponse: ${res.answer}`,
          );
        }

        const transactions = payload.transacoes || [];
        const avisosBalance = validateBalanceConsistency(payload, transactions);
        for (const aviso of avisosBalance) {
          avisos.push(`[${arq.nome}] ${aviso}`);
        }

        const created = await persistNotebookLmTransactions(
          db,
          {
            ...persistCtxBase,
            arquivoIngestaoId: arq.arquivoId,
          },
          transactions,
        );

        arq.movimentacoes_criadas = created;
        totalMovs += created;

        if (transactions.length === 0) {
          avisos.push(`[${arq.nome}] Nenhuma transação extraída do extrato.`);
        }

        const existingRow = pendingById.get(arq.arquivoId);
        let existingMetadados =
          existingRow?.metadados != null && typeof existingRow.metadados === "object"
            ? (existingRow.metadados as Record<string, unknown>)
            : {};
        if (columnMap) {
          existingMetadados = { ...existingMetadados, extratoColumnMap: columnMap };
        }

        const metadados = buildNotebookLmIngestMetadados(
          existingMetadados,
          payload,
          transactions,
          created,
          avisosBalance,
        );

        await upsertIngestaoPagina(db, arq.arquivoId, 1, {
          status: INGESTAO_PAGINA_STATUS.OK,
          modo: "texto",
          aceitas: created,
          incertas: 0,
          motivo:
            transactions.length === 0
              ? "Nenhuma transação extraída"
              : "NotebookLM — arquivo inteiro",
        });

        await db
          .update(arquivoIngestao)
          .set({
            status: ARQUIVO_INGESTAO_STATUS.CONCLUIDO,
            metadados,
            updatedAt: new Date(),
          })
          .where(eq(arquivoIngestao.id, arq.arquivoId));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        arq.erro = message;
        avisos.push(`[${arq.nome}] Erro na extração: ${message}`);
        await db
          .update(arquivoIngestao)
          .set({
            status: ARQUIVO_INGESTAO_STATUS.ERRO,
            erroMensagem: message,
          })
          .where(eq(arquivoIngestao.id, arq.arquivoId));
      }
    }
  }

  const consolidacao: ProcessSessaoResult["consolidacao"] = options?.skipConsolidacao
    ? { skipped: true, reason: "SKIP_FLAG" }
    : await consolidateSession(db, sessaoId);

  return {
    sessaoId,
    uf,
    exercicio,
    consolidarExtratos: sessao.consolidarExtratos,
    arquivos: arquivosResult,
    movimentacoesTotal: totalMovs,
    paginasVerificar: 0,
    consolidacao,
    avisos,
  };
}
