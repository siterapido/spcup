import { type Db, movimentacao } from "@spc-up/db";
import { and, eq, inArray } from "drizzle-orm";

import { MOVIMENTACAO_STATUS } from "../ingest/types";
import { applyDeterministicMatch } from "../match/rules";
import { isNomeContraparteVazio } from "../match/nome-contraparte";
import { hasStructuredContraparteDoc } from "../match/structured-contraparte-docs";
import type { OrigemExtracaoV1 } from "../provenance/types";
import { isStubNome } from "./constants";

const PENDING_STATUSES = [
  MOVIMENTACAO_STATUS.RASCUNHO,
  MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
] as const;

export async function rematchPendingMovimentacoes(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<{ processed: number }> {
  const ufUpper = uf.toUpperCase();
  const rows = await db.query.movimentacao.findMany({
    where: and(
      eq(movimentacao.uf, ufUpper),
      eq(movimentacao.exercicio, exercicio),
      inArray(movimentacao.status, [...PENDING_STATUSES]),
    ),
    with: { pessoaFisica: true, pessoaJuridica: true },
  });

  let processed = 0;
  for (const mov of rows) {
    const origem = mov.origemExtracao as OrigemExtracaoV1 | null;
    const hasDoc = hasStructuredContraparteDoc(origem);
    const hasRemetente = !isNomeContraparteVazio(mov.remetenteDestinatario);
    if (!hasDoc && !hasRemetente) {
      continue;
    }

    const pfStub =
      mov.pessoaFisica != null && isStubNome("PF", mov.pessoaFisica.nome);
    const pjStub =
      mov.pessoaJuridica != null &&
      isStubNome("PJ", mov.pessoaJuridica.razaoSocial);
    const unlinked =
      mov.pessoaFisicaId == null && mov.pessoaJuridicaId == null;

    if (!unlinked && !pfStub && !pjStub) {
      continue;
    }

    await applyDeterministicMatch(db, mov.id);
    processed += 1;
  }

  return { processed };
}
