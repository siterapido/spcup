import type { Db, Movimentacao, PessoaFisica, PessoaJuridica } from "@spc-up/db";
import {
  matchEvidencia,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";
import { eq } from "drizzle-orm";

import {
  isStubNome,
  STUB_PF_NOME,
  STUB_PJ_RAZAO,
} from "../cadastro/constants";
import { DEFAULT_WEIGHTS, evaluateMovimentacao } from "../confidence";
import { normalizeCnpj, normalizeCpf, normalizeName } from "../normalize";
import { MOVIMENTACAO_STATUS } from "../ingest/types";

const DEFAULT_CONFIANCA_LIMITE_ALTA = 0.85;

const CPF_PATTERN =
  /\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/g;
const CNPJ_PATTERN =
  /\b(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|[A-Za-z0-9]{2}\.?[A-Za-z0-9]{3}\.?[A-Za-z0-9]{3}\/?[A-Za-z0-9]{4}-?\d{2})\b/g;

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

export function cleanNomeSugestao(desc: string, docString: string): string {
  let clean = desc.replace(docString, "").replace(/\b(?:CPF|CNPJ)\b/gi, "");
  clean = clean.replace(/\b(CRED PIX|DEB PIX|CRED TEV|DEB TEV|PIX TRANSF|PIX RECEBIDO|RECEBIDO EFETIVADO|PAGTO|PAGAMENTO|TED|DOC|DOC\/TED|DEPOSITO|SAQUE|TARIFA|SALDO|TRANSFERENCIA|TRANSF)\b/gi, "");
  clean = clean.replace(/[-|:,]/g, "").replace(/\s+/g, " ").trim();
  return clean.length >= 3 ? clean : "";
}

async function getOrCreatePessoaFisica(
  db: Db,
  cpf: string,
  nomeSugestao?: string,
): Promise<PessoaFisica> {
  const existing = await db
    .select()
    .from(pessoaFisica)
    .where(eq(pessoaFisica.cpf, cpf))
    .limit(1);
  if (existing[0]) {
    if (isStubNome("PF", existing[0].nome) && nomeSugestao && !isStubNome("PF", nomeSugestao)) {
      const [updated] = await db
        .update(pessoaFisica)
        .set({ nome: nomeSugestao })
        .where(eq(pessoaFisica.id, existing[0].id))
        .returning();
      if (updated) {
        return updated;
      }
    }
    return existing[0];
  }

  const nome = nomeSugestao && !isStubNome("PF", nomeSugestao) ? nomeSugestao : STUB_PF_NOME;
  const [created] = await db
    .insert(pessoaFisica)
    .values({ cpf, nome })
    .returning();
  if (!created) {
    throw new Error(`Failed to create pessoa_fisica for CPF ${cpf}`);
  }
  return created;
}

async function findUniquePessoaByNome(
  db: Db,
  rawNome: string,
): Promise<
  | { kind: "PF"; id: string; nome: string }
  | { kind: "PJ"; id: string; nome: string }
  | null
> {
  const nome = normalizeName(rawNome);
  if (!nome) {
    return null;
  }

  const pfs = await db
    .select({ id: pessoaFisica.id, nome: pessoaFisica.nome })
    .from(pessoaFisica)
    .where(eq(pessoaFisica.nome, nome))
    .limit(2);
  if (pfs.length === 1) {
    return { kind: "PF", id: pfs[0]!.id, nome: pfs[0]!.nome };
  }

  const pjs = await db
    .select({ id: pessoaJuridica.id, nome: pessoaJuridica.razaoSocial })
    .from(pessoaJuridica)
    .where(eq(pessoaJuridica.razaoSocial, nome))
    .limit(2);
  if (pjs.length === 1) {
    return { kind: "PJ", id: pjs[0]!.id, nome: pjs[0]!.nome };
  }

  return null;
}

async function getOrCreatePessoaJuridica(
  db: Db,
  cnpj: string,
  nomeSugestao?: string,
): Promise<PessoaJuridica> {
  const existing = await db
    .select()
    .from(pessoaJuridica)
    .where(eq(pessoaJuridica.cnpj, cnpj))
    .limit(1);
  if (existing[0]) {
    if (
      isStubNome("PJ", existing[0].razaoSocial) &&
      nomeSugestao &&
      !isStubNome("PJ", nomeSugestao)
    ) {
      const [updated] = await db
        .update(pessoaJuridica)
        .set({ razaoSocial: nomeSugestao })
        .where(eq(pessoaJuridica.id, existing[0].id))
        .returning();
      if (updated) {
        return updated;
      }
    }
    return existing[0];
  }

  const razaoSocial = nomeSugestao && !isStubNome("PJ", nomeSugestao) ? nomeSugestao : STUB_PJ_RAZAO;
  const [created] = await db
    .insert(pessoaJuridica)
    .values({ cnpj, razaoSocial })
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
    const docString = current.descricaoRaw.match(CPF_PATTERN)?.[0] || cpf;
    const nomeSugestao = cleanNomeSugestao(current.descricaoRaw, docString);
    const pessoa = await getOrCreatePessoaFisica(db, cpf, nomeSugestao);
    pessoaFisicaId = pessoa.id;
    pessoaJuridicaId = null;
    const cadastroReal = !isStubNome("PF", pessoa.nome);
    evidencias.push({
      tipo: cadastroReal ? "CPF_CADASTRO" : "CPF_EXATO",
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: cadastroReal
        ? `CPF ${cpf} vinculado ao cadastro`
        : `CPF ${cpf} extraido da descricao`,
    });
  } else if (cnpjs.length === 1) {
    const cnpj = cnpjs[0]!;
    const docString = current.descricaoRaw.match(CNPJ_PATTERN)?.[0] || cnpj;
    const nomeSugestao = cleanNomeSugestao(current.descricaoRaw, docString);
    const pessoa = await getOrCreatePessoaJuridica(db, cnpj, nomeSugestao);
    pessoaJuridicaId = pessoa.id;
    pessoaFisicaId = null;
    const cadastroReal = !isStubNome("PJ", pessoa.razaoSocial);
    evidencias.push({
      tipo: cadastroReal ? "CNPJ_CADASTRO" : "CNPJ_EXATO",
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: cadastroReal
        ? `CNPJ ${cnpj} vinculado ao cadastro`
        : `CNPJ ${cnpj} extraido da descricao`,
    });
  } else if (cpfs.length === 0 && cnpjs.length === 0) {
    const byNome = await findUniquePessoaByNome(db, current.descricaoRaw);
    if (byNome?.kind === "PF") {
      pessoaFisicaId = byNome.id;
      pessoaJuridicaId = null;
      const cadastroReal = !isStubNome("PF", byNome.nome);
      evidencias.push({
        tipo: cadastroReal ? "NOME_CADASTRO" : "NOME_EXATO",
        peso: (DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45) * 0.85,
        detalhe: `Nome vinculado ao cadastro: ${byNome.nome}`,
      });
    } else if (byNome?.kind === "PJ") {
      pessoaJuridicaId = byNome.id;
      pessoaFisicaId = null;
      const cadastroReal = !isStubNome("PJ", byNome.nome);
      evidencias.push({
        tipo: cadastroReal ? "NOME_CADASTRO" : "NOME_EXATO",
        peso: (DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45) * 0.85,
        detalhe: `Razão social vinculada ao cadastro: ${byNome.nome}`,
      });
    }
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
