import type { Db } from "@spc-up/db";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { DEFAULT_WEIGHTS } from "../confidence";
import { normalizeName } from "../normalize";
import {
  compararNomeCadastro,
  type NomeCadastroComparacao,
} from "./nome-cadastro";
import { isNomeContraparteVazio } from "./nome-contraparte";

export type CadastroLinkTier = "ALTA" | "MEDIA" | "BAIXA" | "REJEITADO";

export type CadastroLinkResult = {
  tier: CadastroLinkTier;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  comparacaoNome: NomeCadastroComparacao;
  motivo: string;
  evidencias: Array<{ tipo: string; peso: number; detalhe: string }>;
};

export function compararNomeComPessoa(
  nomeExtraido: string,
  pessoa: { nome: string; aliases?: string[] | null },
): NomeCadastroComparacao {
  const base = compararNomeCadastro(nomeExtraido, pessoa.nome);
  if (base === "bate") return "bate";
  for (const alias of pessoa.aliases ?? []) {
    if (compararNomeCadastro(nomeExtraido, alias) === "bate") return "bate";
  }
  return base;
}

export async function findPessoasByNomeFuzzy(
  db: Db,
  rawNome: string,
): Promise<Array<{ kind: "PF" | "PJ"; id: string; nome: string }>> {
  const nome = normalizeName(rawNome);
  if (nome.length < 3) return [];

  const matches: Array<{ kind: "PF" | "PJ"; id: string; nome: string }> = [];

  const pfs = await db
    .select({ id: pessoaFisica.id, nome: pessoaFisica.nome, aliases: pessoaFisica.aliases })
    .from(pessoaFisica);
  for (const pf of pfs) {
    if (compararNomeComPessoa(nome, pf) === "bate") {
      matches.push({ kind: "PF", id: pf.id, nome: pf.nome });
    }
  }

  const pjs = await db
    .select({ id: pessoaJuridica.id, nome: pessoaJuridica.razaoSocial, aliases: pessoaJuridica.aliases })
    .from(pessoaJuridica);
  for (const pj of pjs) {
    if (compararNomeComPessoa(nome, { nome: pj.nome, aliases: pj.aliases }) === "bate") {
      matches.push({ kind: "PJ", id: pj.id, nome: pj.nome });
    }
  }

  return matches;
}

function evidenciaDoc(
  tipo: "CPF_CADASTRO" | "CNPJ_CADASTRO",
  doc: string,
  comparacao: NomeCadastroComparacao,
): Array<{ tipo: string; peso: number; detalhe: string }> {
  const ev: Array<{ tipo: string; peso: number; detalhe: string }> = [
    {
      tipo,
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: `${tipo.includes("CPF") ? "CPF" : "CNPJ"} ${doc} vinculado ao cadastro`,
    },
  ];
  if (comparacao === "difere") {
    ev.push({
      tipo: "NOME_DIVERGE_CADASTRO",
      peso: 0,
      detalhe: "Nome extraído diverge do cadastro",
    });
  }
  return ev;
}

export async function resolveCadastroLink(
  db: Db,
  input: {
    cpf: string | null;
    cnpj: string | null;
    remetenteDestinatario: string | null;
  },
): Promise<CadastroLinkResult> {
  const empty: CadastroLinkResult = {
    tier: "BAIXA",
    pessoaFisicaId: null,
    pessoaJuridicaId: null,
    comparacaoNome: "indefinido",
    motivo: "Sem sinais suficientes",
    evidencias: [],
  };

  if (input.cpf && input.cnpj) {
    return {
      ...empty,
      tier: "REJEITADO",
      motivo: "CPF e CNPJ na mesma linha",
      evidencias: [{ tipo: "CONFLITO_DOCUMENTO", peso: 0, detalhe: "Multiplos documentos" }],
    };
  }

  if (input.cpf) {
    const rows = await db
      .select()
      .from(pessoaFisica)
      .where(eq(pessoaFisica.cpf, input.cpf))
      .limit(1);
    const pf = rows[0];
    if (!pf) {
      return {
        ...empty,
        motivo: `CPF ${input.cpf} ausente no cadastro`,
        evidencias: [{ tipo: "CPF_SEM_CADASTRO", peso: 0, detalhe: "Documento extraído sem cadastro UF" }],
      };
    }
    const comparacao = isNomeContraparteVazio(input.remetenteDestinatario)
      ? "indefinido"
      : compararNomeComPessoa(input.remetenteDestinatario!, pf);
    const tier: CadastroLinkTier =
      comparacao === "bate" ? "ALTA" : "MEDIA";
    return {
      tier,
      pessoaFisicaId: pf.id,
      pessoaJuridicaId: null,
      comparacaoNome: comparacao,
      motivo: tier === "ALTA" ? "CPF cadastro com nome alinhado" : "CPF cadastro; revisar nome",
      evidencias: evidenciaDoc("CPF_CADASTRO", input.cpf, comparacao),
    };
  }

  if (input.cnpj) {
    const rows = await db
      .select()
      .from(pessoaJuridica)
      .where(eq(pessoaJuridica.cnpj, input.cnpj))
      .limit(1);
    const pj = rows[0];
    if (!pj) {
      return {
        ...empty,
        motivo: `CNPJ ${input.cnpj} ausente no cadastro`,
        evidencias: [{ tipo: "CNPJ_SEM_CADASTRO", peso: 0, detalhe: "Documento extraído sem cadastro UF" }],
      };
    }
    const comparacao = isNomeContraparteVazio(input.remetenteDestinatario)
      ? "indefinido"
      : compararNomeComPessoa(input.remetenteDestinatario!, {
          nome: pj.razaoSocial,
          aliases: pj.aliases,
        });
    const tier: CadastroLinkTier =
      comparacao === "bate" ? "ALTA" : "MEDIA";
    return {
      tier,
      pessoaFisicaId: null,
      pessoaJuridicaId: pj.id,
      comparacaoNome: comparacao,
      motivo: tier === "ALTA" ? "CNPJ cadastro com nome alinhado" : "CNPJ cadastro; revisar nome",
      evidencias: evidenciaDoc("CNPJ_CADASTRO", input.cnpj, comparacao),
    };
  }

  if (!isNomeContraparteVazio(input.remetenteDestinatario)) {
    const matches = await findPessoasByNomeFuzzy(db, input.remetenteDestinatario!);
    if (matches.length === 1) {
      const m = matches[0]!;
      return {
        tier: "MEDIA",
        pessoaFisicaId: m.kind === "PF" ? m.id : null,
        pessoaJuridicaId: m.kind === "PJ" ? m.id : null,
        comparacaoNome: "bate",
        motivo: "Nome único no cadastro (sem documento)",
        evidencias: [
          {
            tipo: "NOME_CADASTRO",
            peso: (DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45) * 0.85,
            detalhe: `Nome vinculado: ${m.nome}`,
          },
        ],
      };
    }
    if (matches.length > 1) {
      return {
        ...empty,
        tier: "REJEITADO",
        motivo: "Homônimo: múltiplas pessoas no cadastro",
        evidencias: [{ tipo: "CONFLITO_NOME", peso: 0, detalhe: `${matches.length} candidatos` }],
      };
    }
  }

  return empty;
}
