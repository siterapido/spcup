import type { Db, Movimentacao } from "@spc-up/db";
import { matchEvidencia, movimentacao } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { evaluateMovimentacao } from "../confidence";
import { normalizeCnpj, normalizeCpf } from "../normalize";
import { MOVIMENTACAO_STATUS } from "../ingest/types";
import type { OrigemExtracaoV1 } from "../provenance/types";
import {
  type CadastroLinkTier,
  resolveCadastroLink,
} from "./cadastro-link";
import {
  CNPJ_PATTERN,
  CPF_PATTERN,
  findCnpjInDescricao,
  findCpfInDescricao,
  hasCpfInDescricao,
  stripDocumentsFromDescricao,
} from "./document-in-text";
import { structuredDocsFromOrigemExtracao } from "./structured-contraparte-docs";

export {
  findCnpjInDescricao,
  findCpfInDescricao,
  hasCpfInDescricao,
  stripDocumentsFromDescricao,
};

const DEFAULT_CONFIANCA_LIMITE_ALTA = 0.85;

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

type MovimentacaoForEval = {
  confianca_global: number;
  bloqueio_export: boolean;
  pessoa_fisica_id?: string | null;
  pessoa_juridica_id?: string | null;
  spca?: null;
  evidencias: Array<{ tipo: string; peso: number | null }>;
};

function resolveStatusFromTier(
  tier: CadastroLinkTier,
  score: number,
  confiancaLimiteAlta: number,
  pessoaLinked: boolean,
  bloqueioExport: boolean,
): string {
  if (
    tier === "ALTA" &&
    score >= confiancaLimiteAlta &&
    pessoaLinked &&
    !bloqueioExport
  ) {
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

  const origem = current.origemExtracao as OrigemExtracaoV1 | null | undefined;
  const structured = structuredDocsFromOrigemExtracao(origem);
  const link = await resolveCadastroLink(db, {
    cpf: structured.cpf,
    cnpj: structured.cnpj,
    remetenteDestinatario: current.remetenteDestinatario,
  });

  const pessoaFisicaId = link.pessoaFisicaId;
  const pessoaJuridicaId = link.pessoaJuridicaId;
  const evidencias = link.evidencias;

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
  const pessoaLinked =
    pessoaFisicaId != null || pessoaJuridicaId != null;
  const status = resolveStatusFromTier(
    link.tier,
    score,
    confiancaLimiteAlta,
    pessoaLinked,
    movEval.bloqueio_export,
  );

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
