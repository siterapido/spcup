import {
  cadastroConflito,
  type Db,
  pessoaFisica,
  pessoaJuridica,
} from "@spc-up/db";
import { eq } from "drizzle-orm";

import { normalizeCnpj, normalizeCpf, normalizeName } from "../normalize";
import {
  type CadastroTipo,
  isStubNome,
  STUB_PF_NOME,
  STUB_PJ_RAZAO,
} from "./constants";
import type { CadastroRow, UpsertPessoaResult } from "./types";

export interface UpsertPessoaContext {
  uf?: string;
  exercicio?: number;
  origem: "IMPORT" | "MANUAL";
}

const SEM_CONTEXTO_UF = "—";
const SEM_CONTEXTO_EXERCICIO = 0;

async function findPessoaFisica(db: Db, cpf: string) {
  const rows = await db
    .select()
    .from(pessoaFisica)
    .where(eq(pessoaFisica.cpf, cpf))
    .limit(1);
  return rows[0];
}

async function findPessoaJuridica(db: Db, cnpj: string) {
  const rows = await db
    .select()
    .from(pessoaJuridica)
    .where(eq(pessoaJuridica.cnpj, cnpj))
    .limit(1);
  return rows[0];
}

export async function upsertPessoa(
  db: Db,
  row: Pick<CadastroRow, "tipo" | "documento" | "nome"> & { tituloEleitor?: string | null },
  ctx: UpsertPessoaContext,
): Promise<UpsertPessoaResult> {
  const uf = ctx.uf?.toUpperCase() ?? SEM_CONTEXTO_UF;
  const exercicio = ctx.exercicio ?? SEM_CONTEXTO_EXERCICIO;
  const documento =
    row.tipo === "PF" ? normalizeCpf(row.documento) : normalizeCnpj(row.documento);
  const nome = normalizeName(row.nome);

  if (row.tipo === "PF") {
    const existing = await findPessoaFisica(db, documento);
    if (!existing) {
      const [created] = await db
        .insert(pessoaFisica)
        .values({
          cpf: documento,
          nome,
          tituloEleitor: row.tituloEleitor?.trim() || null,
        })
        .returning();
      if (!created) {
        throw new Error(`Failed to insert pessoa_fisica ${row.documento}`);
      }
      return { action: "inserted", pessoaFisicaId: created.id };
    }

    if (existing.nome === nome) {
      return { action: "unchanged", pessoaFisicaId: existing.id };
    }

    if (isStubNome("PF", existing.nome)) {
      const patch: { nome: string; updatedAt: Date; tituloEleitor?: string | null } = {
        nome,
        updatedAt: new Date(),
      };
      if (row.tituloEleitor !== undefined) {
        patch.tituloEleitor = row.tituloEleitor?.trim() || null;
      }
      const [updated] = await db
        .update(pessoaFisica)
        .set(patch)
        .where(eq(pessoaFisica.id, existing.id))
        .returning();
      if (!updated) {
        throw new Error(`Failed to update pessoa_fisica ${existing.id}`);
      }
      return { action: "updated", pessoaFisicaId: updated.id };
    }

    const [conflito] = await db
      .insert(cadastroConflito)
      .values({
        tipo: "PF",
        documento,
        nomeExistente: existing.nome,
        nomeProposto: nome,
        origem: ctx.origem,
        ufContexto: uf,
        exercicioContexto: exercicio,
        pessoaFisicaId: existing.id,
      })
      .returning();
    return {
      action: "conflict",
      pessoaFisicaId: existing.id,
      conflitoId: conflito?.id,
    };
  }

  const existing = await findPessoaJuridica(db, documento);
  if (!existing) {
    const [created] = await db
      .insert(pessoaJuridica)
      .values({ cnpj: documento, razaoSocial: nome })
      .returning();
    if (!created) {
      throw new Error(`Failed to insert pessoa_juridica ${row.documento}`);
    }
    return { action: "inserted", pessoaJuridicaId: created.id };
  }

  if (existing.razaoSocial === nome) {
    return { action: "unchanged", pessoaJuridicaId: existing.id };
  }

  if (isStubNome("PJ", existing.razaoSocial)) {
    const [updated] = await db
      .update(pessoaJuridica)
      .set({ razaoSocial: nome, updatedAt: new Date() })
      .where(eq(pessoaJuridica.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error(`Failed to update pessoa_juridica ${existing.id}`);
    }
    return { action: "updated", pessoaJuridicaId: updated.id };
  }

  const [conflito] = await db
    .insert(cadastroConflito)
    .values({
      tipo: "PJ",
      documento,
      nomeExistente: existing.razaoSocial,
      nomeProposto: nome,
      origem: ctx.origem,
      ufContexto: uf,
      exercicioContexto: exercicio,
      pessoaJuridicaId: existing.id,
    })
    .returning();

  return {
    action: "conflict",
    pessoaJuridicaId: existing.id,
    conflitoId: conflito?.id,
  };
}

export { STUB_PF_NOME, STUB_PJ_RAZAO, type CadastroTipo };
