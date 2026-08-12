import { compararNomeCadastro } from "../match/nome-cadastro";
import type { CadastroLinkTier } from "../match/cadastro-link";
import { normalizeName } from "../normalize";
import { buildOrigemAtributos } from "../provenance/build-origem-atributos";
import type { OrigemExtracaoV1 } from "../provenance/types";
import { classifyArquivoPapel, resolveLinhaPapel } from "./classify-arquivo";
import type {
  CadastroMatchContext,
  ConsolidacaoEventDraft,
  ConsolidacaoHipoteseDraft,
  ConsolidacaoLinhaDraft,
  ConsolidacaoLinhaPapel,
  MovimentacaoCandidate,
  PessoaRef,
} from "./types";
import { contraparteDoHistorico } from "./contraparte-historico";
import { campoExtracao } from "../ingest/campos-extracao";

function extractDocsFromMov(m: MovimentacaoCandidate): {
  cpf: string | null;
  cnpj: string | null;
} {
  return { cpf: m.cpfExtraido, cnpj: m.cnpjExtraido };
}

function transactionKey(m: MovimentacaoCandidate): string {
  return [m.dataMovimento, m.valor, m.direcao.toUpperCase()].join("|");
}

function linhaDraft(
  m: MovimentacaoCandidate,
  arquivoBaseIngestaoId: string,
): ConsolidacaoLinhaDraft {
  return {
    movimentacaoId: m.id,
    arquivoIngestaoId: m.arquivoIngestaoId,
    papel: resolveLinhaPapel(m, arquivoBaseIngestaoId),
    descricaoRaw: m.descricaoRaw,
  };
}

function resolvePessoa(
  cpf: string | null,
  cnpj: string | null,
  ctx: CadastroMatchContext,
): PessoaRef | null {
  if (cpf && ctx.pessoaByCpf.has(cpf)) {
    return ctx.pessoaByCpf.get(cpf)!;
  }
  if (cnpj && ctx.pessoaByCnpj.has(cnpj)) {
    return ctx.pessoaByCnpj.get(cnpj)!;
  }
  return null;
}

function remetenteFromMov(m: MovimentacaoCandidate): string {
  return normalizeName(m.remetenteDestinatario ?? "");
}

function remetenteOuHistorico(m: MovimentacaoCandidate, papel: ConsolidacaoLinhaPapel): string {
  if (papel === "COMPLETO") {
    const h = campoExtracao(m, "historico");
    const parsed = contraparteDoHistorico(h ?? "");
    if (parsed) {
      return parsed;
    }
  }
  return remetenteFromMov(m);
}

function minutesFromHora(raw: string | null | undefined): number | null {
  const match = raw?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

function dayFromDate(date: string): number | null {
  const match = date.match(/^\d{4}-\d{2}-(\d{2})$/);
  return match ? Number(match[1]) : null;
}

function dayTimeFromDocumento(raw: string | null | undefined): {
  day: number;
  minutes: number;
} | null {
  const digits = raw?.replace(/\D/g, "") ?? "";
  if (digits.length !== 6) return null;
  const day = Number(digits.slice(0, 2));
  const hours = Number(digits.slice(2, 4));
  const minutes = Number(digits.slice(4, 6));
  if (day < 1 || day > 31 || hours > 23 || minutes > 59) return null;
  return { day, minutes: hours * 60 + minutes };
}

function pixTotalDocumentoHoraMatch(a: MovimentacaoCandidate, b: MovimentacaoCandidate): boolean {
  const papelA = classifyArquivoPapel(a.nomeArquivo);
  const papelB = classifyArquivoPapel(b.nomeArquivo);
  if (!(
    (papelA === "PIX" && papelB === "COMPLETO") ||
    (papelA === "COMPLETO" && papelB === "PIX")
  )) {
    return false;
  }

  const pix = papelA === "PIX" ? a : b;
  const completo = papelA === "COMPLETO" ? a : b;
  const pixDay = dayFromDate(pix.dataMovimento);
  const pixMinutes = minutesFromHora(campoExtracao(pix, "hora"));
  const completoDayTime = dayTimeFromDocumento(campoExtracao(completo, "documento"));
  if (pixDay == null || pixMinutes == null || !completoDayTime) return false;

  return (
    completoDayTime.day === pixDay &&
    Math.abs(completoDayTime.minutes - pixMinutes) <= 5
  );
}

function nomesBatem(extraido: string, cadastro: string): boolean {
  return compararNomeCadastro(extraido, cadastro) === "bate";
}

function pairEligible(a: MovimentacaoCandidate, b: MovimentacaoCandidate): boolean {
  const docsA = extractDocsFromMov(a);
  const docsB = extractDocsFromMov(b);
  if (docsA.cpf && docsB.cpf && docsA.cpf === docsB.cpf) return true;
  if (docsA.cnpj && docsB.cnpj && docsA.cnpj === docsB.cnpj) return true;
  const papelA = classifyArquivoPapel(a.nomeArquivo);
  const papelB = classifyArquivoPapel(b.nomeArquivo);
  const nomeA = remetenteOuHistorico(a, papelA);
  const nomeB = remetenteOuHistorico(b, papelB);
  if (pixTotalDocumentoHoraMatch(a, b)) return true;
  if (nomeA.length >= 3 && nomeB.length >= 3 && nomesBatem(nomeA, nomeB)) return true;
  if ((docsA.cpf || docsA.cnpj || docsB.cpf || docsB.cnpj) && nomesBatem(nomeA, nomeB)) {
    return true;
  }
  return false;
}

function hasDocOnEitherSide(a: MovimentacaoCandidate, b?: MovimentacaoCandidate): boolean {
  const docsA = extractDocsFromMov(a);
  if (docsA.cpf || docsA.cnpj) return true;
  if (!b) return false;
  const docsB = extractDocsFromMov(b);
  return !!(docsB.cpf || docsB.cnpj);
}

function cadastroLinkTierFromScore(
  confianca: number,
  pessoa: PessoaRef | null,
  hasDoc: boolean,
): CadastroLinkTier {
  if (confianca >= 0.9 && pessoa && hasDoc) return "ALTA";
  if (confianca >= 0.8) return "MEDIA";
  return "BAIXA";
}

function findUniquePessoaByNome(ctx: CadastroMatchContext, nome: string): PessoaRef | null {
  const normalized = normalizeName(nome);
  if (normalized.length < 3) return null;

  const matches = [
    ...[...ctx.pessoaByCpf.values()].filter((p) => nomesBatem(normalized, p.nome)),
    ...[...ctx.pessoaByCnpj.values()].filter((p) => nomesBatem(normalized, p.nome)),
  ];
  return matches.length === 1 ? matches[0]! : null;
}

function scorePair(
  a: MovimentacaoCandidate,
  b: MovimentacaoCandidate,
  ctx: CadastroMatchContext,
): { confianca: number; justificativa: string; pessoa: PessoaRef | null } {
  const docsA = extractDocsFromMov(a);
  const docsB = extractDocsFromMov(b);
  const cpfA = docsA.cpf;
  const cpfB = docsB.cpf;
  const cnpjA = docsA.cnpj;
  const cnpjB = docsB.cnpj;

  if (cpfA && cpfB && cpfA === cpfB) {
    const pessoa = resolvePessoa(cpfA, null, ctx);
    return {
      confianca: 0.95,
      justificativa: "Mesmo CPF nos dois extratos",
      pessoa,
    };
  }

  if (cnpjA && cnpjB && cnpjA === cnpjB) {
    const pessoa = resolvePessoa(null, cnpjA, ctx);
    return {
      confianca: 0.95,
      justificativa: "Mesmo CNPJ nos dois extratos",
      pessoa,
    };
  }

  const cpfCompleto = cpfB ?? cpfA;
  const cnpjCompleto = cnpjB ?? cnpjA;
  const papelA = classifyArquivoPapel(a.nomeArquivo);
  const papelB = classifyArquivoPapel(b.nomeArquivo);
  const nomePix = remetenteOuHistorico(a, papelA);
  const nomeCompleto = remetenteOuHistorico(b, papelB);
  const pessoaByCpf = cpfCompleto ? resolvePessoa(cpfCompleto, null, ctx) : null;
  const pessoaByCnpj = cnpjCompleto ? resolvePessoa(null, cnpjCompleto, ctx) : null;

  if (pixTotalDocumentoHoraMatch(a, b)) {
    const nomePix = papelA === "PIX"
      ? remetenteFromMov(a)
      : papelB === "PIX"
        ? remetenteFromMov(b)
        : "";
    const pessoa =
      pessoaByCpf ??
      pessoaByCnpj ??
      findUniquePessoaByNome(ctx, nomePix) ??
      null;
    return {
      confianca: pessoa ? 0.85 : 0.75,
      justificativa: pessoa
        ? "Mesmo valor/direção e documento DDHHMM alinhado ao PIX e cadastro"
        : "Mesmo valor/direção e documento DDHHMM alinhado ao horário do PIX",
      pessoa,
    };
  }

  if (
    cpfCompleto &&
    pessoaByCpf &&
    (nomesBatem(nomePix, pessoaByCpf.nome) ||
      nomesBatem(nomeCompleto, pessoaByCpf.nome) ||
      nomesBatem(nomePix, nomeCompleto))
  ) {
    return {
      confianca: 0.9,
      justificativa: "CPF no extrato completo e nome alinhado ao cadastro",
      pessoa: pessoaByCpf,
    };
  }

  if (
    cnpjCompleto &&
    pessoaByCnpj &&
    (nomesBatem(nomePix, pessoaByCnpj.nome) ||
      nomesBatem(nomeCompleto, pessoaByCnpj.nome) ||
      nomesBatem(nomePix, nomeCompleto))
  ) {
    return {
      confianca: 0.9,
      justificativa: "CNPJ no extrato completo e nome alinhado ao cadastro",
      pessoa: pessoaByCnpj,
    };
  }

  if (nomePix.length >= 3 && nomesBatem(nomePix, nomeCompleto)) {
    const pessoa =
      pessoaByCpf ??
      pessoaByCnpj ??
      findUniquePessoaByNome(ctx, nomePix) ??
      findUniquePessoaByNome(ctx, nomeCompleto) ??
      null;
    return {
      confianca: pessoa ? 0.8 : 0.65,
      justificativa: pessoa
        ? "Mesma data/valor/direção e nome único no cadastro"
        : "Mesma data/valor/direção e remetente/destinatário equivalente",
      pessoa,
    };
  }

  return {
    confianca: 0.55,
    justificativa: "Mesma data/valor/direção; nomes divergentes",
    pessoa: null,
  };
}

function pessoaIds(pessoa: PessoaRef | null): {
  pessoaFisicaId?: string;
  pessoaJuridicaId?: string;
} {
  if (!pessoa) {
    return {};
  }
  if (pessoa.kind === "PF") {
    return { pessoaFisicaId: pessoa.id };
  }
  return { pessoaJuridicaId: pessoa.id };
}

function scoreSingle(
  m: MovimentacaoCandidate,
  ctx: CadastroMatchContext,
): { confianca: number; justificativa: string; pessoa: PessoaRef | null } {
  const { cpf, cnpj } = extractDocsFromMov(m);
  const pessoa = resolvePessoa(cpf, cnpj, ctx);
  if (pessoa && (cpf || cnpj)) {
    return {
      confianca: 0.85,
      justificativa: cpf ? "CPF na linha com cadastro" : "CNPJ na linha com cadastro",
      pessoa,
    };
  }
  const nome = remetenteFromMov(m);
  const byNome = findUniquePessoaByNome(ctx, nome);
  if (byNome) {
    return { confianca: 0.8, justificativa: "Nome único no cadastro", pessoa: byNome };
  }
  return { confianca: 0.4, justificativa: "Sem vínculo cadastro", pessoa: null };
}

/** Score cadastro for a base line without PIX — parse histórico only for match, not Rem/Dest column. */
function scoreSingleBase(
  m: MovimentacaoCandidate,
  ctx: CadastroMatchContext,
): { confianca: number; justificativa: string; pessoa: PessoaRef | null } {
  const fromDocs = scoreSingle(m, ctx);
  if (fromDocs.pessoa) {
    return fromDocs;
  }
  const historico = campoExtracao(m, "historico");
  const parsed = contraparteDoHistorico(historico ?? "");
  if (parsed) {
    const byNome = findUniquePessoaByNome(ctx, parsed);
    if (byNome) {
      return {
        confianca: 0.55,
        justificativa: "Nome inferido do histórico (cadastro)",
        pessoa: byNome,
      };
    }
  }
  return fromDocs;
}

function isPixCandidate(m: MovimentacaoCandidate, arquivoBaseIngestaoId: string): boolean {
  if (m.arquivoIngestaoId === arquivoBaseIngestaoId) {
    return false;
  }
  if (m.extratoModeloId === "caixa_pix") {
    return true;
  }
  return classifyArquivoPapel(m.nomeArquivo) === "PIX";
}

export type BuildConsolidacaoCandidatesResult = {
  drafts: ConsolidacaoEventDraft[];
  pixOrfaos: MovimentacaoCandidate[];
};

type PairCandidate = {
  a: MovimentacaoCandidate;
  b: MovimentacaoCandidate;
  confianca: number;
  justificativa: string;
  pessoa: PessoaRef | null;
};

type WeakPairCandidate = PairCandidate;

function hipoteseFromWeakPair(
  other: MovimentacaoCandidate,
  justificativa: string,
): ConsolidacaoHipoteseDraft {
  return {
    tipo: "PAR_PDF_FRACO",
    confianca: 0.55,
    payload: {
      movimentacaoId: other.id,
      arquivoIngestaoId: other.arquivoIngestaoId,
      justificativa,
    },
  };
}

/** Build consolidation event drafts from session movimentações and cadastro context. */
function finalizeDraft(
  draft: Omit<ConsolidacaoEventDraft, "origemAtributos">,
  movById: Map<string, MovimentacaoCandidate>,
): ConsolidacaoEventDraft {
  return {
    ...draft,
    origemAtributos: buildOrigemAtributos(draft, movById),
  };
}

function horaDeltaMinutes(ha: string, hb: string): number {
  const [ah, am] = ha.split(":").map(Number);
  const [bh, bm] = hb.split(":").map(Number);
  return Math.abs(ah * 60 + am - (bh * 60 + bm));
}

function horaReinforcesPair(
  a: OrigemExtracaoV1 | null,
  b: OrigemExtracaoV1 | null,
): "ok" | "weak" | "skip" {
  const ha = a?.horaContraparte;
  const hb = b?.horaContraparte;
  if (!ha || !hb) return "skip";
  const delta = horaDeltaMinutes(ha, hb);
  if (delta <= 5) return "ok";
  if (delta > 60) return "weak";
  return "skip";
}

function isDateWindowMatch(a: MovimentacaoCandidate, b: MovimentacaoCandidate): boolean {
  const papelA = classifyArquivoPapel(a.nomeArquivo);
  const papelB = classifyArquivoPapel(b.nomeArquivo);

  if ((papelA === "PIX" && papelB === "COMPLETO") || (papelA === "COMPLETO" && papelB === "PIX")) {
    const pix = papelA === "PIX" ? a : b;
    const completo = papelA === "COMPLETO" ? a : b;

    const datePix = new Date(pix.dataMovimento + "T12:00:00");
    const dateComp = new Date(completo.dataMovimento + "T12:00:00");

    const diffTime = dateComp.getTime() - datePix.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    return diffDays >= 0 && diffDays <= 3;
  }

  return a.dataMovimento === b.dataMovimento;
}

export function buildConsolidacaoCandidates(
  movs: MovimentacaoCandidate[],
  ctx: CadastroMatchContext,
  options: { arquivoBaseIngestaoId: string },
): BuildConsolidacaoCandidatesResult {
  const { arquivoBaseIngestaoId } = options;
  const movById = new Map(movs.map((m) => [m.id, m]));
  const baseMovs = movs.filter((m) => m.arquivoIngestaoId === arquivoBaseIngestaoId);
  const pixMovs = movs.filter((m) => isPixCandidate(m, arquivoBaseIngestaoId));

  const usedPix = new Set<string>();
  const events: ConsolidacaoEventDraft[] = [];

  const sortedBase = [...baseMovs].sort((x, y) =>
    x.dataMovimento.localeCompare(y.dataMovimento),
  );
  const sortedPix = [...pixMovs].sort((x, y) =>
    x.dataMovimento.localeCompare(y.dataMovimento),
  );

  type BasePixPair = PairCandidate & { base: MovimentacaoCandidate; pix: MovimentacaoCandidate };

  const pairCandidates: BasePixPair[] = [];
  const weakPairCandidates: (BasePixPair & { justificativa: string })[] = [];

  for (const base of sortedBase) {
    for (const pix of sortedPix) {
      if (base.contaBancariaId && pix.contaBancariaId && base.contaBancariaId !== pix.contaBancariaId) {
        continue;
      }
      if (base.valor !== pix.valor || base.direcao !== pix.direcao || !isDateWindowMatch(pix, base)) {
        continue;
      }
      const scored = scorePair(pix, base, ctx);
      const horaVerdict = horaReinforcesPair(pix.origemExtracao, base.origemExtracao);
      if (horaVerdict === "weak") {
        weakPairCandidates.push({
          a: pix,
          b: base,
          base,
          pix,
          ...scored,
          justificativa: `${scored.justificativa}; hora divergente (>60min)`,
        });
        continue;
      }
      if (scored.confianca === 0.55) {
        weakPairCandidates.push({ a: pix, b: base, base, pix, ...scored });
        continue;
      }
      if (!pairEligible(pix, base)) {
        continue;
      }
      pairCandidates.push({ a: pix, b: base, base, pix, ...scored });
    }
  }

  pairCandidates.sort((x, y) => {
    if (y.confianca !== x.confianca) {
      return y.confianca - x.confianca;
    }
    return x.base.dataMovimento.localeCompare(y.base.dataMovimento);
  });

  const baseToPix = new Map<string, MovimentacaoCandidate>();

  for (const pair of pairCandidates) {
    if (usedPix.has(pair.pix.id) || baseToPix.has(pair.base.id)) {
      continue;
    }
    usedPix.add(pair.pix.id);
    baseToPix.set(pair.base.id, pair.pix);
  }

  const weakHipotesesByBaseId = new Map<string, ConsolidacaoHipoteseDraft[]>();
  for (const weak of weakPairCandidates) {
    if (baseToPix.has(weak.base.id)) {
      continue;
    }
    const list = weakHipotesesByBaseId.get(weak.base.id) ?? [];
    list.push(hipoteseFromWeakPair(weak.pix, weak.justificativa));
    weakHipotesesByBaseId.set(weak.base.id, list);
  }

  for (const base of sortedBase) {
    const pix = baseToPix.get(base.id);
    const hipoteses = weakHipotesesByBaseId.get(base.id) ?? [];

    if (pix) {
      const scored = scorePair(pix, base, ctx);
      const evidencias = [
        {
          tipo: "CRUZAMENTO_PDF",
          detalhe: `Par ${pix.nomeArquivo} ↔ ${base.nomeArquivo}`,
          peso: scored.confianca,
        },
      ];
      if (scored.pessoa) {
        evidencias.push({
          tipo: "CADASTRO_UF",
          detalhe: `${scored.pessoa.kind} ${scored.pessoa.nome}`,
          peso: 0.85,
        });
      }

      events.push(
        finalizeDraft(
          {
            dataMovimento: base.dataMovimento,
            valor: base.valor,
            direcao: base.direcao,
            confianca: scored.confianca,
            justificativa: scored.justificativa,
            cadastroLinkTier: cadastroLinkTierFromScore(
              scored.confianca,
              scored.pessoa,
              hasDocOnEitherSide(pix, base),
            ),
            ...pessoaIds(scored.pessoa),
            linhas: [
              linhaDraft(base, arquivoBaseIngestaoId),
              linhaDraft(pix, arquivoBaseIngestaoId),
            ],
            hipoteses,
            evidencias,
          },
          movById,
        ),
      );
      continue;
    }

    const single = scoreSingleBase(base, ctx);
    events.push(
      finalizeDraft(
        {
          dataMovimento: base.dataMovimento,
          valor: base.valor,
          direcao: base.direcao,
          confianca: single.confianca,
          justificativa: single.justificativa,
          cadastroLinkTier: cadastroLinkTierFromScore(
            single.confianca,
            single.pessoa,
            hasDocOnEitherSide(base),
          ),
          ...pessoaIds(single.pessoa),
          linhas: [linhaDraft(base, arquivoBaseIngestaoId)],
          hipoteses,
          evidencias: single.pessoa
            ? [
                {
                  tipo: "CADASTRO_UF",
                  detalhe: single.pessoa.nome,
                  peso: single.confianca,
                },
              ]
            : [],
        },
        movById,
      ),
    );
  }

  const pixOrfaos = sortedPix.filter((p) => !usedPix.has(p.id));

  return {
    drafts: events.sort((a, b) => b.confianca - a.confianca),
    pixOrfaos,
  };
}
