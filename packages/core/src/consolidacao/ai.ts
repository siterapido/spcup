import { pessoaFisica, pessoaJuridica, type Db } from "@spc-up/db";
import type { ConsolidacaoEventDraft, MovimentacaoCandidate } from "./types";
import { runConsolidacaoCritique } from "../ai/openrouter";
import { hasPessoaVinculo } from "./auto";
import { getConfiancaLimiarAlta, getConfiancaLimiarBaixa } from "./thresholds";

type SessaoContext = { uf: string; exercicio: number };

/** Use primary and reviewer models to complement and critique matches for low confidence events. */
export async function enrichAmbiguousWithAi(
  db: Db,
  drafts: ConsolidacaoEventDraft[],
  _movs: MovimentacaoCandidate[],
  sessaoCtx: SessaoContext,
): Promise<ConsolidacaoEventDraft[]> {
  if (process.env.DISABLE_OPENROUTER === "true" || !process.env.OPENROUTER_API_KEY) {
    return drafts;
  }

  const limiarAlta = getConfiancaLimiarAlta();
  const limiarBaixa = getConfiancaLimiarBaixa();

  // IA complementa regras: tudo abaixo do limiar de auto-aprovação (cruzamento PDF + cadastro + nomes).
  const eligibleDrafts = drafts.filter((d) => {
    if (d.linhas.length < 1) {
      return false;
    }
    if (d.confianca >= limiarAlta) {
      return false;
    }
    if (hasPessoaVinculo(d) && d.confianca < limiarBaixa) {
      return false;
    }
    return true;
  });

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
