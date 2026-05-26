import type { Db, Movimentacao, PessoaFisica, PessoaJuridica } from "@spc-up/db";
import {
  matchEvidencia,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";
import { eq } from "drizzle-orm";

import { DEFAULT_WEIGHTS, evaluateMovimentacao } from "../confidence";
import { normalizeCnpj, normalizeCpf } from "../normalize";
import { MOVIMENTACAO_STATUS } from "../ingest/types";

const DEFAULT_CONFIANCA_LIMITE_ALTA = 0.85;

const CPF_PATTERN =
  /\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/g;
const CNPJ_PATTERN =
  /\b(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|[A-Za-z0-9]{2}\.?[A-Za-z0-9]{3}\.?[A-Za-z0-9]{3}\/?[A-Za-z0-9]{4}-?\d{2})\b/g;

const STUB_PF_NOME = "DESCONHECIDO";
const STUB_PJ_RAZAO = "DESCONHECIDA";

type DocType = "CPF" | "CNPJ";

export function extractDocumentCandidates(
  descricao: string,
): Array<{ docType: DocType; normalized: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ docType: DocType; normalized: string }> = [];

  for (const match of descricao.matchAll(CNPJ_PATTERN)) {
    const raw = match[0];
    try {
      const normalized = normalizeCnpj(raw);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        candidates.push({ docType: "CNPJ", normalized });
      }
    } catch {
      continue;
    }
  }

  for (const match of descricao.matchAll(CPF_PATTERN)) {
    const raw = match[0];
    try {
      const normalized = normalizeCpf(raw);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        candidates.push({ docType: "CPF", normalized });
      }
    } catch {
      continue;
    }
  }

  return candidates;
}

async function getOrCreatePessoaFisica(db: Db, cpf: string): Promise<PessoaFisica> {
  const existing = await db
    .select()
    .from(pessoaFisica)
    .where(eq(pessoaFisica.cpf, cpf))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const [created] = await db
    .insert(pessoaFisica)
    .values({ cpf, nome: STUB_PF_NOME })
    .returning();
  if (!created) {
    throw new Error(`Failed to create pessoa_fisica for CPF ${cpf}`);
  }
  return created;
}

async function getOrCreatePessoaJuridica(
  db: Db,
  cnpj: string,
): Promise<PessoaJuridica> {
  const existing = await db
    .select()
    .from(pessoaJuridica)
    .where(eq(pessoaJuridica.cnpj, cnpj))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const [created] = await db
    .insert(pessoaJuridica)
    .values({ cnpj, razaoSocial: STUB_PJ_RAZAO })
    .returning();
  if (!created) {
    throw new Error(`Failed to create pessoa_juridica for CNPJ ${cnpj}`);
  }
  return created;
}

type MovimentacaoForEval = {
  confianca_global: number;
  bloqueio_export: boolean;
  pessoa_fisica_id?: string | null;
  pessoa_juridica_id?: string | null;
  spca?: null;
  evidencias: Array<{ tipo: string; peso: number | null }>;
};

function resolveStatus(
  mov: MovimentacaoForEval,
  score: number,
  confiancaLimiteAlta: number,
): string {
  if (score < confiancaLimiteAlta) {
    return MOVIMENTACAO_STATUS.PENDENTE_REVISAO;
  }
  const pessoaLinked =
    mov.pessoa_fisica_id != null || mov.pessoa_juridica_id != null;
  if (pessoaLinked && !mov.bloqueio_export) {
    return MOVIMENTACAO_STATUS.CONFIRMADO;
  }
  return MOVIMENTACAO_STATUS.PENDENTE_REVISAO;
}

export interface ApplyDeterministicMatchOptions {
  confiancaLimiteAlta?: number;
}

/** Extract CPF/CNPJ from description, link pessoa, score and update status. */
export async function applyDeterministicMatch(
  db: Db,
  movimentacaoId: string,
  options?: ApplyDeterministicMatchOptions,
): Promise<Movimentacao> {
  const confiancaLimiteAlta =
    options?.confiancaLimiteAlta ?? DEFAULT_CONFIANCA_LIMITE_ALTA;

  const rows = await db
    .select()
    .from(movimentacao)
    .where(eq(movimentacao.id, movimentacaoId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    throw new Error(`Movimentacao ${movimentacaoId} not found`);
  }

  await db
    .delete(matchEvidencia)
    .where(eq(matchEvidencia.movimentacaoId, movimentacaoId));

  const evidencias: Array<{ tipo: string; peso: number; detalhe: string }> = [];
  const cpfs: string[] = [];
  const cnpjs: string[] = [];

  for (const { docType, normalized } of extractDocumentCandidates(
    current.descricaoRaw,
  )) {
    if (docType === "CPF") {
      cpfs.push(normalized);
    } else {
      cnpjs.push(normalized);
    }
  }

  let pessoaFisicaId: string | null = current.pessoaFisicaId;
  let pessoaJuridicaId: string | null = current.pessoaJuridicaId;

  if (cpfs.length > 1 || cnpjs.length > 1 || (cpfs.length > 0 && cnpjs.length > 0)) {
    evidencias.push({
      tipo: "CONFLITO_DOCUMENTO",
      peso: 0,
      detalhe: "Multiplos documentos encontrados na descricao",
    });
  } else if (cpfs.length === 1) {
    const cpf = cpfs[0]!;
    const pessoa = await getOrCreatePessoaFisica(db, cpf);
    pessoaFisicaId = pessoa.id;
    pessoaJuridicaId = null;
    evidencias.push({
      tipo: "CPF_EXATO",
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: `CPF ${cpf} extraido da descricao`,
    });
  } else if (cnpjs.length === 1) {
    const cnpj = cnpjs[0]!;
    const pessoa = await getOrCreatePessoaJuridica(db, cnpj);
    pessoaJuridicaId = pessoa.id;
    pessoaFisicaId = null;
    evidencias.push({
      tipo: "CNPJ_EXATO",
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: `CNPJ ${cnpj} extraido da descricao`,
    });
  }

  if (evidencias.length > 0) {
    await db.insert(matchEvidencia).values(
      evidencias.map((ev) => ({
        movimentacaoId,
        tipo: ev.tipo,
        peso: ev.peso,
        detalhe: ev.detalhe,
      })),
    );
  }

  const movEval: MovimentacaoForEval = {
    confianca_global: current.confiancaGlobal,
    bloqueio_export: current.bloqueioExport,
    pessoa_fisica_id: pessoaFisicaId,
    pessoa_juridica_id: pessoaJuridicaId,
    spca: null,
    evidencias: evidencias.map((ev) => ({ tipo: ev.tipo, peso: ev.peso })),
  };

  const score = evaluateMovimentacao(movEval);
  const status = resolveStatus(movEval, score, confiancaLimiteAlta);

  const [updated] = await db
    .update(movimentacao)
    .set({
      pessoaFisicaId,
      pessoaJuridicaId,
      confiancaGlobal: movEval.confianca_global,
      bloqueioExport: movEval.bloqueio_export,
      status,
    })
    .where(eq(movimentacao.id, movimentacaoId))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update movimentacao ${movimentacaoId}`);
  }

  return updated;
}
