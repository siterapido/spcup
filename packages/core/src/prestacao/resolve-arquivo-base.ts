import { arquivoIngestao, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";

import {
  detectExtratoModeloFromFilename,
  type ExtratoModeloId,
} from "../ingest/extrato-modelo";
import { persistArquivoBaseIngestaoId } from "./sessao";

export type ArquivoIngestaoBaseCandidate = {
  id: string;
  nome: string;
};

export class ResolveArquivoBaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveArquivoBaseError";
  }
}

function resolveModeloId(
  arquivoId: string,
  nome: string,
  extratoModeloIds?: Record<string, ExtratoModeloId>,
): ExtratoModeloId {
  return extratoModeloIds?.[arquivoId] ?? detectExtratoModeloFromFilename(nome);
}

export function resolveArquivoBaseId(
  arquivos: ArquivoIngestaoBaseCandidate[],
  extratoModeloIds?: Record<string, ExtratoModeloId>,
  explicitId?: string,
): string | null {
  const totais = arquivos.filter(
    (arq) => resolveModeloId(arq.id, arq.nome, extratoModeloIds) === "caixa_total",
  );

  if (totais.length === 0) {
    return null;
  }

  if (totais.length === 1) {
    const only = totais[0]!;
    if (explicitId && explicitId !== only.id) {
      throw new ResolveArquivoBaseError(
        `arquivoBaseIngestaoId informado não corresponde ao único extrato Total da sessão.`,
      );
    }
    return only.id;
  }

  if (!explicitId) {
    throw new ResolveArquivoBaseError(
      `Sessão possui ${totais.length} extratos Total. Selecione qual é o extrato base antes de processar.`,
    );
  }

  const match = totais.some((t) => t.id === explicitId);
  if (!match) {
    throw new ResolveArquivoBaseError(
      `arquivoBaseIngestaoId informado não é um extrato Total válido desta sessão.`,
    );
  }

  return explicitId;
}

export async function listPdfArquivosSessao(
  db: Db,
  sessaoId: string,
): Promise<ArquivoIngestaoBaseCandidate[]> {
  const rows = await db
    .select({ id: arquivoIngestao.id, nomeArquivo: arquivoIngestao.nomeArquivo })
    .from(arquivoIngestao)
    .where(eq(arquivoIngestao.sessaoPrestacaoId, sessaoId));
  return rows
    .filter((r) => /\.pdf$/i.test(r.nomeArquivo))
    .map((r) => ({ id: r.id, nome: r.nomeArquivo }));
}

export async function persistArquivoBaseOnProcessStart(
  db: Db,
  sessaoId: string,
  sessaoArquivoBaseIngestaoId: string | null,
  options?: {
    extratoModeloIds?: Record<string, ExtratoModeloId>;
    arquivoBaseIngestaoId?: string;
  },
): Promise<string | null> {
  const arquivos = await listPdfArquivosSessao(db, sessaoId);
  const explicitId =
    options?.arquivoBaseIngestaoId ?? sessaoArquivoBaseIngestaoId ?? undefined;
  const resolved = resolveArquivoBaseId(arquivos, options?.extratoModeloIds, explicitId);
  await persistArquivoBaseIngestaoId(db, sessaoId, resolved);
  return resolved;
}
