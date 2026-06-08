import {
  matchEvidencia,
  movimentacao,
  movimentacaoSpca,
  pessoaFisica,
  pessoaJuridica,
  type Db,
  type Movimentacao,
} from "@spc-up/db";
import { eq, like } from "drizzle-orm";

import { REQUIRED_SPCA_FIELDS, evaluateMovimentacao } from "../confidence";
import { MOVIMENTACAO_STATUS } from "../ingest/types";
import { normalizeCnpj, normalizeCpf } from "../normalize";
import { extractDocumentCandidates } from "./rules";
import {
  evaluateMovimentacaoWithAi,
  type AiMatchResult,
  type EvaluateAiMatchInput,
} from "./ai";

function isValidDocument(tipo: "PF" | "PJ", documento: string): boolean {
  try {
    if (tipo === "PF") {
      normalizeCpf(documento);
    } else {
      normalizeCnpj(documento);
    }
    return true;
  } catch {
    return false;
  }
}

async function loadCadastroCandidates(
  db: Db,
  descricaoRaw: string,
  documentoSugerido: string | null,
  pessoaTipo: "PF" | "PJ" | null,
): Promise<EvaluateAiMatchInput["candidatos"]> {
  const candidatos: EvaluateAiMatchInput["candidatos"] = [];
  const seen = new Set<string>();

  const add = (tipo: "PF" | "PJ", documento: string, nome: string) => {
    const key = `${tipo}:${documento}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidatos.push({ tipo, documento, nome });
  };

  for (const { docType, normalized } of extractDocumentCandidates(descricaoRaw)) {
    if (docType === "CPF") {
      const rows = await db
        .select({ cpf: pessoaFisica.cpf, nome: pessoaFisica.nome })
        .from(pessoaFisica)
        .where(eq(pessoaFisica.cpf, normalized))
        .limit(1);
      add("PF", normalized, rows[0]?.nome ?? "Cadastro pendente");
    } else {
      const rows = await db
        .select({ cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
        .from(pessoaJuridica)
        .where(eq(pessoaJuridica.cnpj, normalized))
        .limit(1);
      add("PJ", normalized, rows[0]?.nome ?? "Cadastro pendente");
    }
  }

  if (documentoSugerido && pessoaTipo) {
    if (pessoaTipo === "PF") {
      const rows = await db
        .select({ cpf: pessoaFisica.cpf, nome: pessoaFisica.nome })
        .from(pessoaFisica)
        .where(eq(pessoaFisica.cpf, documentoSugerido))
        .limit(1);
      add("PF", documentoSugerido, rows[0]?.nome ?? "Cadastro pendente");
    } else {
      const rows = await db
        .select({ cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
        .from(pessoaJuridica)
        .where(eq(pessoaJuridica.cnpj, documentoSugerido))
        .limit(1);
      add("PJ", documentoSugerido, rows[0]?.nome ?? "Cadastro pendente");
    }
  }

  const tokens = descricaoRaw.split(/\s+/).filter((t) => t.length >= 4).slice(0, 3);
  for (const token of tokens) {
    const pattern = `%${token}%`;
    const pfRows = await db
      .select({ cpf: pessoaFisica.cpf, nome: pessoaFisica.nome })
      .from(pessoaFisica)
      .where(like(pessoaFisica.nome, pattern))
      .limit(3);
    for (const row of pfRows) {
      add("PF", row.cpf, row.nome);
    }
    const pjRows = await db
      .select({ cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
      .from(pessoaJuridica)
      .where(like(pessoaJuridica.razaoSocial, pattern))
      .limit(3);
    for (const row of pjRows) {
      add("PJ", row.cnpj, row.nome);
    }
  }

  return candidatos;
}

function lacunasFromSpca(
  spca: typeof movimentacaoSpca.$inferSelect | null | undefined,
): string[] {
  if (!spca) {
    return [...REQUIRED_SPCA_FIELDS];
  }
  const missing: string[] = [];
  if (!spca.fonteRecurso) missing.push("fonte_recurso");
  if (!spca.naturezaRecurso) missing.push("natureza_recurso");
  if (!spca.tipoOrigemRecurso) missing.push("tipo_origem_recurso");
  return missing;
}

function buildEvidenciasFromAi(result: AiMatchResult): Array<{
  tipo: string;
  peso: number;
  detalhe: string;
}> {
  const list: Array<{ tipo: string; peso: number; detalhe: string }> = [
    {
      tipo: "IA_MESMO_EVENTO",
      peso: result.confianca,
      detalhe: result.mesmo_evento ? "mesmo evento" : "evento incerto",
    },
    {
      tipo: "IA_JUSTIFICATIVA",
      peso: 0,
      detalhe: result.justificativa,
    },
  ];
  for (const ev of result.evidencias) {
    list.push({ tipo: ev.tipo, peso: 0, detalhe: ev.detalhe });
  }
  for (const campo of result.campos_faltantes) {
    list.push({ tipo: "LACUNA_XSD", peso: 0, detalhe: campo });
  }
  return list;
}

export interface ApplyAiMatchOptions {
  fetch?: typeof fetch;
  apiKey?: string;
  model?: string;
}

/** Run Kimi match, persist evidencias, update movimentacao (piloto: sempre PENDENTE_REVISAO). */
export async function applyAiMatchToMovimentacao(
  db: Db,
  movimentacaoId: string,
  options?: ApplyAiMatchOptions,
): Promise<Movimentacao> {
  const rows = await db
    .select()
    .from(movimentacao)
    .where(eq(movimentacao.id, movimentacaoId))
    .limit(1);
  const current = rows[0];
  if (!current) {
    throw new Error(`Movimentacao ${movimentacaoId} not found`);
  }

  if (
    current.status === MOVIMENTACAO_STATUS.CONFIRMADO ||
    current.status === MOVIMENTACAO_STATUS.EXPORTADO
  ) {
    return current;
  }

  const spcaRows = await db
    .select()
    .from(movimentacaoSpca)
    .where(eq(movimentacaoSpca.movimentacaoId, movimentacaoId))
    .limit(1);

  let aiResult: AiMatchResult | null = null;
  let iaIndisponivel = false;

  const candidatos = await loadCadastroCandidates(db, current.descricaoRaw, null, null);

  if (candidatos.length > 0) {
    try {
      aiResult = await evaluateMovimentacaoWithAi(
        {
          valor: current.valor,
          dataMovimento: String(current.dataMovimento),
          direcao: current.direcao,
          descricaoRaw: current.descricaoRaw,
          uf: current.uf,
          exercicio: current.exercicio,
          tipoPrestador: current.tipoPrestador,
          candidatos,
        },
        options,
      );
    } catch {
      iaIndisponivel = true;
    }
  }

  await db
    .delete(matchEvidencia)
    .where(eq(matchEvidencia.movimentacaoId, movimentacaoId));

  const evidencias = iaIndisponivel
    ? [{ tipo: "IA_INDISPONIVEL", peso: 0, detalhe: "OpenRouter indisponível" }]
    : aiResult
      ? buildEvidenciasFromAi(aiResult)
      : [];

  let pessoaFisicaId: string | null = current.pessoaFisicaId;
  let pessoaJuridicaId: string | null = current.pessoaJuridicaId;
  let bloqueioExport = current.bloqueioExport;

  if (aiResult?.pessoa_tipo && aiResult.pessoa_documento) {
    const doc = aiResult.pessoa_documento;
    if (!isValidDocument(aiResult.pessoa_tipo, doc)) {
      bloqueioExport = true;
      evidencias.push({
        tipo: "DOCUMENTO_INVALIDO",
        peso: 0,
        detalhe: `Documento inválido: ${doc}`,
      });
    } else if (aiResult.pessoa_tipo === "PF") {
      const pf = await db.query.pessoaFisica.findFirst({
        where: eq(pessoaFisica.cpf, normalizeCpf(doc)),
      });
      if (pf) {
        pessoaFisicaId = pf.id;
        pessoaJuridicaId = null;
      }
    } else {
      const pj = await db.query.pessoaJuridica.findFirst({
        where: eq(pessoaJuridica.cnpj, normalizeCnpj(doc)),
      });
      if (pj) {
        pessoaJuridicaId = pj.id;
        pessoaFisicaId = null;
      }
    }
  }

  const lacunas = [
    ...new Set([
      ...lacunasFromSpca(spcaRows[0]),
      ...(aiResult?.campos_faltantes ?? []),
    ]),
  ];
  if (lacunas.length > 0) {
    bloqueioExport = true;
    for (const campo of lacunas) {
      if (!evidencias.some((e) => e.tipo === "LACUNA_XSD" && e.detalhe === campo)) {
        evidencias.push({ tipo: "LACUNA_XSD", peso: 0, detalhe: campo });
      }
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

  const confiancaGlobal =
    iaIndisponivel || !aiResult ? current.confiancaGlobal : (aiResult.confianca ?? 0);

  const movEval = {
    confianca_global: confiancaGlobal,
    bloqueio_export: bloqueioExport,
    pessoa_fisica_id: pessoaFisicaId,
    pessoa_juridica_id: pessoaJuridicaId,
    spca: null,
    evidencias: evidencias.map((ev) => ({ tipo: ev.tipo, peso: ev.peso })),
  };
  evaluateMovimentacao(movEval);

  const status =
    iaIndisponivel || !aiResult
      ? MOVIMENTACAO_STATUS.RASCUNHO
      : MOVIMENTACAO_STATUS.PENDENTE_REVISAO;

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
