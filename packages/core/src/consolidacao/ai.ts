import { pessoaFisica, pessoaJuridica, type Db } from "@spc-up/db";
import type { ConsolidacaoEventDraft, MovimentacaoCandidate } from "./types";
import { runConsolidacaoCritique } from "../ai/openrouter";

const AMBIGUOUS_MIN = 0.40;
const AMBIGUOUS_MAX = 0.85;

type SessaoContext = { uf: string; exercicio: number };

/** Use primary and reviewer models to complement and critique matches for low confidence events. */
export async function enrichAmbiguousWithAi(
  db: Db,
  drafts: ConsolidacaoEventDraft[],
  _movs: MovimentacaoCandidate[],
  sessaoCtx: SessaoContext,
): Promise<ConsolidacaoEventDraft[]> {
  if (!process.env.OPENROUTER_API_KEY) {
    return drafts;
  }

  // 1. Filter candidates eligible for AI match-review (low confidence or missing registry link)
  const eligibleDrafts = drafts.filter(
    (d) =>
      d.confianca >= AMBIGUOUS_MIN &&
      d.confianca <= AMBIGUOUS_MAX &&
      d.linhas.length >= 1
  );

  if (eligibleDrafts.length === 0) {
    return drafts;
  }

  // 2. Fetch the registration databases for context mapping
  const pfs = await db
    .select({
      id: pessoaFisica.id,
      nome: pessoaFisica.nome,
      cpf: pessoaFisica.cpf,
    })
    .from(pessoaFisica);

  const pjs = await db
    .select({
      id: pessoaJuridica.id,
      nome: pessoaJuridica.razaoSocial,
      cnpj: pessoaJuridica.cnpj,
    })
    .from(pessoaJuridica);

  // 3. Process primary suggestion + reviewer critique
  await runConsolidacaoCritique(
    eligibleDrafts,
    { pfs, pjs },
    sessaoCtx
  );

  return drafts;
}
