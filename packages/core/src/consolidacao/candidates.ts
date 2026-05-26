import { extractDocumentCandidates } from "../match/rules";
import { normalizeName } from "../normalize";
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

  if (cpfA && cpfB && cpfA === cpfB) {
    const pessoa = resolvePessoa(cpfA, null, ctx);
    return {
      confianca: 0.95,
      justificativa: "Mesmo CPF nos dois extratos",
      pessoa,
    };
  }

  const cpfCompleto = cpfB ?? cpfA;
  const nomePix = nomeFromDescricao(a.descricaoRaw);
  const nomeCompleto = nomeFromDescricao(b.descricaoRaw);
  const pessoaByCpf = cpfCompleto ? resolvePessoa(cpfCompleto, null, ctx) : null;

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

  if (nomePix.length >= 3 && nomePix === nomeCompleto) {
    const pessoa =
      pessoaByCpf ??
      (ctx.pessoaByCpf.size === 0
        ? null
        : [...ctx.pessoaByCpf.values()].find(
            (p) => normalizeName(p.nome) === nomePix,
          ) ?? null);
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
  if (pessoa && cpf) {
    return { confianca: 0.85, justificativa: "CPF na linha com cadastro", pessoa };
  }
  const nome = nomeFromDescricao(m.descricaoRaw);
  const byNome = [...ctx.pessoaByCpf.values()].find(
    (p) => normalizeName(p.nome) === nome,
  );
  if (byNome) {
    return { confianca: 0.8, justificativa: "Nome único no cadastro", pessoa: byNome };
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
export function buildConsolidacaoCandidates(
  movs: MovimentacaoCandidate[],
  ctx: CadastroMatchContext,
): ConsolidacaoEventDraft[] {
  const used = new Set<string>();
  const events: ConsolidacaoEventDraft[] = [];

  const pairCandidates: PairCandidate[] = [];
  for (let i = 0; i < movs.length; i++) {
    for (let j = i + 1; j < movs.length; j++) {
      const a = movs[i]!;
      const b = movs[j]!;
      if (a.arquivoIngestaoId === b.arquivoIngestaoId) {
        continue;
      }
      if (transactionKey(a) !== transactionKey(b)) {
        continue;
      }
      const scored = scorePair(a, b, ctx);
      pairCandidates.push({ a, b, ...scored });
    }
  }

  pairCandidates.sort((x, y) => y.confianca - x.confianca);

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

    events.push({
      dataMovimento: pair.a.dataMovimento,
      valor: pair.a.valor,
      direcao: pair.a.direcao,
      confianca: pair.confianca,
      justificativa: pair.justificativa,
      ...pessoaIds(pair.pessoa),
      linhas,
      hipoteses,
      evidencias,
    });
  }

  for (const m of movs) {
    if (used.has(m.id)) {
      continue;
    }
    const single = scoreSingle(m, ctx);
    events.push({
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
    });
  }

  return events.sort((a, b) => b.confianca - a.confianca);
}
