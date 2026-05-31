import { extractDocumentCandidates } from "../match/rules";
import { normalizeName } from "../normalize";
import { buildOrigemAtributos } from "../provenance/build-origem-atributos";
import { classifyArquivoPapel } from "./classify-arquivo";
import type {
  CadastroMatchContext,
  ConsolidacaoEventDraft,
  ConsolidacaoHipoteseDraft,
  ConsolidacaoLinhaDraft,
  MovimentacaoCandidate,
  PessoaRef,
} from "./types";

function extractDocsFromMov(m: MovimentacaoCandidate): {
  cpf: string | null;
  cnpj: string | null;
} {
  if (m.cpfExtraido) {
    return { cpf: m.cpfExtraido, cnpj: m.cnpjExtraido };
  }
  const candidates = extractDocumentCandidates(m.descricaoRaw);
  let cpf: string | null = null;
  let cnpj: string | null = null;
  for (const c of candidates) {
    if (c.docType === "CPF" && !cpf) {
      cpf = c.normalized;
    }
    if (c.docType === "CNPJ" && !cnpj) {
      cnpj = c.normalized;
    }
  }
  return { cpf, cnpj };
}

function nomeFromDescricao(descricaoRaw: string): string {
  const withoutDoc = descricaoRaw
    .replace(/\bCPF\s+\d{11}\b/gi, "")
    .replace(/\bCNPJ\s+\d{14}\b/gi, "")
    .trim();
  return normalizeName(withoutDoc);
}

function transactionKey(m: MovimentacaoCandidate): string {
  return [m.dataMovimento, m.valor, m.direcao.toUpperCase()].join("|");
}

function linhaDraft(m: MovimentacaoCandidate): ConsolidacaoLinhaDraft {
  return {
    movimentacaoId: m.id,
    arquivoIngestaoId: m.arquivoIngestaoId,
    papel: classifyArquivoPapel(m.nomeArquivo),
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
  const nomePix = nomeFromDescricao(a.descricaoRaw);
  const nomeCompleto = nomeFromDescricao(b.descricaoRaw);
  const pessoaByCpf = cpfCompleto ? resolvePessoa(cpfCompleto, null, ctx) : null;
  const pessoaByCnpj = cnpjCompleto ? resolvePessoa(null, cnpjCompleto, ctx) : null;

  if (
    cpfCompleto &&
    pessoaByCpf &&
    (nomePix === normalizeName(pessoaByCpf.nome) || nomePix === nomeCompleto)
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
    (nomePix === normalizeName(pessoaByCnpj.nome) || nomePix === nomeCompleto)
  ) {
    return {
      confianca: 0.9,
      justificativa: "CNPJ no extrato completo e nome alinhado ao cadastro",
      pessoa: pessoaByCnpj,
    };
  }

  if (nomePix.length >= 3 && nomePix === nomeCompleto) {
    const pessoa =
      pessoaByCpf ??
      pessoaByCnpj ??
      [...ctx.pessoaByCpf.values()].find((p) => normalizeName(p.nome) === nomePix) ??
      [...ctx.pessoaByCnpj.values()].find((p) => normalizeName(p.nome) === nomePix) ??
      null;
    return {
      confianca: pessoa ? 0.8 : 0.65,
      justificativa: pessoa
        ? "Mesma data/valor/direção e nome único no cadastro"
        : "Mesma data/valor/direção e descrição equivalente",
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
  const nome = nomeFromDescricao(m.descricaoRaw);
  const byNomePF = [...ctx.pessoaByCpf.values()].find(
    (p) => normalizeName(p.nome) === nome,
  );
  if (byNomePF) {
    return { confianca: 0.8, justificativa: "Nome único no cadastro", pessoa: byNomePF };
  }
  const byNomePJ = [...ctx.pessoaByCnpj.values()].find(
    (p) => normalizeName(p.nome) === nome,
  );
  if (byNomePJ) {
    return { confianca: 0.8, justificativa: "Nome único no cadastro", pessoa: byNomePJ };
  }
  return { confianca: 0.4, justificativa: "Sem vínculo cadastro", pessoa: null };
}

type PairCandidate = {
  a: MovimentacaoCandidate;
  b: MovimentacaoCandidate;
  confianca: number;
  justificativa: string;
  pessoa: PessoaRef | null;
};

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
): ConsolidacaoEventDraft[] {
  const movById = new Map(movs.map((m) => [m.id, m]));
  const used = new Set<string>();
  const events: ConsolidacaoEventDraft[] = [];

  // Sort movimentacoes chronologically to guarantee stable chronological pairing (FIFO) for repeating values
  const sortedMovs = [...movs].sort((x, y) => x.dataMovimento.localeCompare(y.dataMovimento));

  const pairCandidates: PairCandidate[] = [];
  for (let i = 0; i < sortedMovs.length; i++) {
    for (let j = i + 1; j < sortedMovs.length; j++) {
      const a = sortedMovs[i]!;
      const b = sortedMovs[j]!;
      if (a.arquivoIngestaoId === b.arquivoIngestaoId) {
        continue;
      }
      // Ensure transactions belong to the same bank account if specified
      if (a.contaBancariaId && b.contaBancariaId && a.contaBancariaId !== b.contaBancariaId) {
        continue;
      }
      if (a.valor !== b.valor || a.direcao !== b.direcao || !isDateWindowMatch(a, b)) {
        continue;
      }
      const scored = scorePair(a, b, ctx);
      pairCandidates.push({ a, b, ...scored });
    }
  }

  // Sort by confidence descending, then by chronological order of transaction to preserve FIFO resolution
  pairCandidates.sort((x, y) => {
    if (y.confianca !== x.confianca) {
      return y.confianca - x.confianca;
    }
    return x.a.dataMovimento.localeCompare(y.a.dataMovimento);
  });

  for (const pair of pairCandidates) {
    if (used.has(pair.a.id) || used.has(pair.b.id)) {
      continue;
    }
    used.add(pair.a.id);
    used.add(pair.b.id);

    const linhas = [linhaDraft(pair.a), linhaDraft(pair.b)];
    const hipoteses: ConsolidacaoHipoteseDraft[] = [];

    const evidencias = [
      {
        tipo: "CRUZAMENTO_PDF",
        detalhe: `Par ${pair.a.nomeArquivo} ↔ ${pair.b.nomeArquivo}`,
        peso: pair.confianca,
      },
    ];
    if (pair.pessoa) {
      evidencias.push({
        tipo: "CADASTRO_UF",
        detalhe: `${pair.pessoa.kind} ${pair.pessoa.nome}`,
        peso: 0.85,
      });
    }

    events.push(
      finalizeDraft(
        {
          dataMovimento: pair.a.dataMovimento,
          valor: pair.a.valor,
          direcao: pair.a.direcao,
          confianca: pair.confianca,
          justificativa: pair.justificativa,
          ...pessoaIds(pair.pessoa),
          linhas,
          hipoteses,
          evidencias,
        },
        movById,
      ),
    );
  }

  for (const m of movs) {
    if (used.has(m.id)) {
      continue;
    }
    const single = scoreSingle(m, ctx);
    events.push(
      finalizeDraft(
        {
          dataMovimento: m.dataMovimento,
          valor: m.valor,
          direcao: m.direcao,
          confianca: single.confianca,
          justificativa: single.justificativa,
          ...pessoaIds(single.pessoa),
          linhas: [linhaDraft(m)],
          hipoteses: [],
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

  return events.sort((a, b) => b.confianca - a.confianca);
}
