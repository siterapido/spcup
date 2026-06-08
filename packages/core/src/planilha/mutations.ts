import {
  consolidacaoEvento,
  consolidacaoLinha,
  matchEvidencia,
  movimentacao,
  pessoaFisica,
  pessoaJuridica,
  type Db,
} from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";

import { getConfiancaLimiarBaixa } from "../consolidacao/thresholds";

import {
  approveConsolidacaoEvento,
  rejectConsolidacaoEvento,
} from "../consolidacao/approve";
import { loadCadastroMatchContext } from "../consolidacao/load";
import { isNomeContraparteVazio } from "../match/nome-contraparte";
import { applyDeterministicMatch, extractDocumentCandidates } from "../match/rules";
import { normalizeName } from "../normalize";
import {
  assignPessoaToMovimentacao,
  type AssignPessoaInput,
} from "../prestacao/movimentacao-review";
import type { PlanilhaLinhaFonte } from "./types";

async function findUniquePessoaByNome(
  db: Db,
  rawNome: string,
): Promise<
  | { kind: "PF"; id: string }
  | { kind: "PJ"; id: string }
  | null
> {
  const nome = normalizeName(rawNome);
  if (!nome) return null;

  const pfs = await db
    .select({ id: pessoaFisica.id })
    .from(pessoaFisica)
    .where(eq(pessoaFisica.nome, nome))
    .limit(2);
  if (pfs.length === 1) {
    return { kind: "PF", id: pfs[0]!.id };
  }

  const pjs = await db
    .select({ id: pessoaJuridica.id })
    .from(pessoaJuridica)
    .where(eq(pessoaJuridica.razaoSocial, nome))
    .limit(2);
  if (pjs.length === 1) {
    return { kind: "PJ", id: pjs[0]!.id };
  }

  return null;
}

async function rematchConsolidacaoEventoPorNome(
  db: Db,
  eventoId: string,
): Promise<void> {
  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, eventoId),
    with: {
      linhas: { with: { movimentacao: true } },
    },
  });
  if (!evento) return;

  const cpfs = new Set<string>();
  const cnpjs = new Set<string>();
  for (const linha of evento.linhas) {
    for (const { docType, normalized } of extractDocumentCandidates(
      linha.movimentacao.descricaoRaw,
    )) {
      if (docType === "CPF") cpfs.add(normalized);
      else cnpjs.add(normalized);
    }
  }

  const ctx = await loadCadastroMatchContext(db);
  let pessoaFisicaId: string | null = null;
  let pessoaJuridicaId: string | null = null;
  let justificativa: string | undefined;

  if (cpfs.size === 1 && cnpjs.size === 0) {
    const cpf = [...cpfs][0]!;
    const pessoa = ctx.pessoaByCpf.get(cpf);
    if (pessoa?.kind === "PF") {
      pessoaFisicaId = pessoa.id;
      justificativa = "CPF nas origens com cadastro";
    }
  } else if (cnpjs.size === 1 && cpfs.size === 0) {
    const cnpj = [...cnpjs][0]!;
    const pessoa = ctx.pessoaByCnpj.get(cnpj);
    if (pessoa?.kind === "PJ") {
      pessoaJuridicaId = pessoa.id;
      justificativa = "CNPJ nas origens com cadastro";
    }
  }

  if (!pessoaFisicaId && !pessoaJuridicaId) {
    const remetenteDestinatario = evento.remetenteDestinatario;
    if (!isNomeContraparteVazio(remetenteDestinatario)) {
      const byNome = await findUniquePessoaByNome(db, remetenteDestinatario!);
      if (byNome?.kind === "PF") {
        pessoaFisicaId = byNome.id;
        justificativa = "Nome único no cadastro";
      } else if (byNome?.kind === "PJ") {
        pessoaJuridicaId = byNome.id;
        justificativa = "Nome único no cadastro";
      }
    }
  }

  if (!pessoaFisicaId && !pessoaJuridicaId) return;

  await db
    .update(consolidacaoEvento)
    .set({
      pessoaFisicaId,
      pessoaJuridicaId,
      confianca: 0.85,
      justificativa,
    })
    .where(eq(consolidacaoEvento.id, eventoId));
}

export async function updatePlanilhaLinhaRemetenteDestinatario(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
  remetenteDestinatario: string | null,
): Promise<void> {
  const normalized =
    remetenteDestinatario && !isNomeContraparteVazio(remetenteDestinatario)
      ? normalizeName(remetenteDestinatario)
      : null;

  if (fonte === "movimentacao") {
    await db
      .update(movimentacao)
      .set({ remetenteDestinatario: normalized })
      .where(eq(movimentacao.id, linhaId));

    const mov = await db.query.movimentacao.findFirst({
      where: eq(movimentacao.id, linhaId),
      columns: { pessoaFisicaId: true, pessoaJuridicaId: true },
    });
    if (!mov?.pessoaFisicaId && !mov?.pessoaJuridicaId) {
      await applyDeterministicMatch(db, linhaId);
    }
    return;
  }

  await db
    .update(consolidacaoEvento)
    .set({ remetenteDestinatario: normalized })
    .where(eq(consolidacaoEvento.id, linhaId));

  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, linhaId),
    columns: { pessoaFisicaId: true, pessoaJuridicaId: true },
  });
  if (!evento?.pessoaFisicaId && !evento?.pessoaJuridicaId) {
    await rematchConsolidacaoEventoPorNome(db, linhaId);
  }
}

export async function planilhaLinhaBelongsToSessao(
  db: Db,
  sessaoId: string,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
): Promise<boolean> {
  if (fonte === "movimentacao") {
    const row = await db.query.movimentacao.findFirst({
      where: and(eq(movimentacao.id, linhaId), isNull(movimentacao.deletedAt)),
      columns: { sessaoPrestacaoId: true },
    });
    return row?.sessaoPrestacaoId === sessaoId;
  }

  const row = await db.query.consolidacaoEvento.findFirst({
    where: and(
      eq(consolidacaoEvento.id, linhaId),
      isNull(consolidacaoEvento.deletedAt),
    ),
    columns: { sessaoPrestacaoId: true },
  });
  return row?.sessaoPrestacaoId === sessaoId;
}

export async function updatePlanilhaLinhaPessoa(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
  body: {
    pessoaFisicaId?: string;
    pessoaJuridicaId?: string;
    limparPessoa?: true;
  },
): Promise<void> {
  if (fonte === "movimentacao") {
    const pessoa: AssignPessoaInput = body.limparPessoa
      ? { limparPessoa: true }
      : body.pessoaFisicaId
        ? { pessoaFisicaId: body.pessoaFisicaId }
        : { pessoaJuridicaId: body.pessoaJuridicaId! };
    await assignPessoaToMovimentacao(db, linhaId, pessoa);
    return;
  }

  await db
    .update(consolidacaoEvento)
    .set({
      pessoaFisicaId: body.limparPessoa ? null : (body.pessoaFisicaId ?? null),
      pessoaJuridicaId: body.limparPessoa ? null : (body.pessoaJuridicaId ?? null),
      confianca:
        body.pessoaFisicaId || body.pessoaJuridicaId ? 0.95 : undefined,
      justificativa:
        body.pessoaFisicaId || body.pessoaJuridicaId
          ? "Vínculo manual na planilha"
          : undefined,
    })
    .where(eq(consolidacaoEvento.id, linhaId));
}

export async function applyPlanilhaLote(
  db: Db,
  items: Array<{ id: string; fonte: PlanilhaLinhaFonte }>,
  pessoa: { pessoaFisicaId?: string; pessoaJuridicaId?: string },
): Promise<void> {
  for (const item of items) {
    await updatePlanilhaLinhaPessoa(db, item.id, item.fonte, pessoa);
  }
}

export async function resolvePlanilhaMerge(
  db: Db,
  eventoId: string,
  acao: "confirmar" | "separar",
  deps: {
    approveConsolidacaoEvento?: typeof approveConsolidacaoEvento;
    rejectConsolidacaoEvento?: typeof rejectConsolidacaoEvento;
  } = {},
): Promise<void> {
  const approve = deps.approveConsolidacaoEvento ?? approveConsolidacaoEvento;
  const reject = deps.rejectConsolidacaoEvento ?? rejectConsolidacaoEvento;

  if (acao === "confirmar") {
    await approve(db, eventoId);
    return;
  }

  await reject(db, eventoId);
}

const EVIDENCIA_EXTRACAO_CONFIRMADA = "EXTRACAO_CONFIRMADA";

async function confirmarExtracaoMovimentacao(db: Db, movimentacaoId: string): Promise<void> {
  const mov = await db.query.movimentacao.findFirst({
    where: eq(movimentacao.id, movimentacaoId),
    columns: { confiancaGlobal: true },
  });
  if (!mov) {
    throw new Error("Movimentação não encontrada");
  }

  const limiar = getConfiancaLimiarBaixa();
  const confiancaNova = Math.max(mov.confiancaGlobal, limiar);

  await db
    .delete(matchEvidencia)
    .where(
      and(
        eq(matchEvidencia.movimentacaoId, movimentacaoId),
        eq(matchEvidencia.tipo, "PAGINA_VERIFICAR"),
      ),
    );

  const jaConfirmada = await db.query.matchEvidencia.findFirst({
    where: and(
      eq(matchEvidencia.movimentacaoId, movimentacaoId),
      eq(matchEvidencia.tipo, EVIDENCIA_EXTRACAO_CONFIRMADA),
    ),
    columns: { id: true },
  });

  if (!jaConfirmada) {
    await db.insert(matchEvidencia).values({
      movimentacaoId,
      tipo: EVIDENCIA_EXTRACAO_CONFIRMADA,
      peso: 1,
      detalhe: "Extração confirmada na planilha",
    });
  }

  await db
    .update(movimentacao)
    .set({ confiancaGlobal: confiancaNova })
    .where(eq(movimentacao.id, movimentacaoId));
}

export async function confirmarExtracaoPlanilhaLinha(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
): Promise<void> {
  if (fonte === "movimentacao") {
    await confirmarExtracaoMovimentacao(db, linhaId);
    return;
  }

  const linhas = await db
    .select({ movimentacaoId: consolidacaoLinha.movimentacaoId })
    .from(consolidacaoLinha)
    .where(eq(consolidacaoLinha.eventoId, linhaId));

  if (linhas.length === 0) {
    throw new Error("Evento de consolidação não encontrado");
  }

  for (const linha of linhas) {
    await confirmarExtracaoMovimentacao(db, linha.movimentacaoId);
  }

  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, linhaId),
    columns: { confianca: true },
  });
  if (evento) {
    const limiar = getConfiancaLimiarBaixa();
    await db
      .update(consolidacaoEvento)
      .set({ confianca: Math.max(evento.confianca, limiar) })
      .where(eq(consolidacaoEvento.id, linhaId));
  }
}
