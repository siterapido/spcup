import { type Db, pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { and, eq, isNull } from "drizzle-orm";

import { normalizeName } from "../normalize";
import type { CadastroTipo } from "./constants";
import type { PessoaRef } from "./delete";

export type UpdatePessoaFields = {
  nome?: string;
  tituloEleitor?: string | null;
  aliases?: string[] | null;
};

export type UpdatePessoaItem = PessoaRef & UpdatePessoaFields;

export type UpdatePessoasSkipped = PessoaRef & { reason: string };

export type UpdatePessoasResult = {
  updated: number;
  unchanged: number;
  skipped: UpdatePessoasSkipped[];
};

function aliasesEqual(a: string[] | null | undefined, b: string[] | null | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export async function updatePessoa(
  db: Db,
  id: string,
  tipo: CadastroTipo,
  fields: UpdatePessoaFields,
): Promise<"updated" | "unchanged" | "not_found" | "invalid"> {
  const hasNome = fields.nome !== undefined;
  const hasTitulo = fields.tituloEleitor !== undefined;
  const hasAliases = fields.aliases !== undefined;
  if (!hasNome && !hasTitulo && !hasAliases) return "invalid";

  if (tipo === "PF") {
    const rows = await db
      .select()
      .from(pessoaFisica)
      .where(and(eq(pessoaFisica.id, id), isNull(pessoaFisica.deletedAt)))
      .limit(1);
    const existing = rows[0];
    if (!existing) return "not_found";

    const patch: {
      nome?: string;
      tituloEleitor?: string | null;
      aliases?: string[] | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (hasNome) {
      const nome = normalizeName(fields.nome ?? "");
      if (!nome) return "invalid";
      patch.nome = nome;
    }
    if (hasTitulo) {
      patch.tituloEleitor = fields.tituloEleitor?.trim() || null;
    }
    if (hasAliases) {
      patch.aliases = fields.aliases;
    }

    const nomeSame = !hasNome || existing.nome === patch.nome;
    const tituloSame =
      !hasTitulo || existing.tituloEleitor === patch.tituloEleitor;
    const aliasesSame = !hasAliases || aliasesEqual(existing.aliases, patch.aliases);
    if (nomeSame && tituloSame && aliasesSame) return "unchanged";

    await db.update(pessoaFisica).set(patch).where(eq(pessoaFisica.id, id));
    return "updated";
  }

  const rows = await db
    .select()
    .from(pessoaJuridica)
    .where(and(eq(pessoaJuridica.id, id), isNull(pessoaJuridica.deletedAt)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return "not_found";

  const patch: {
    razaoSocial?: string;
    aliases?: string[] | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };

  if (hasNome) {
    const nome = normalizeName(fields.nome ?? "");
    if (!nome) return "invalid";
    patch.razaoSocial = nome;
  }
  if (hasAliases) {
    patch.aliases = fields.aliases;
  }
  if (fields.tituloEleitor !== undefined) return "invalid";

  const nomeSame = !hasNome || existing.razaoSocial === patch.razaoSocial;
  const aliasesSame = !hasAliases || aliasesEqual(existing.aliases, patch.aliases);
  if (nomeSame && aliasesSame) return "unchanged";

  await db.update(pessoaJuridica).set(patch).where(eq(pessoaJuridica.id, id));
  return "updated";
}

export async function updatePessoas(
  db: Db,
  items: UpdatePessoaItem[],
): Promise<UpdatePessoasResult> {
  const skipped: UpdatePessoasSkipped[] = [];
  let updated = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${item.tipo}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { id, tipo, ...fields } = item;
    const result = await updatePessoa(db, id, tipo, fields);

    if (result === "updated") {
      updated += 1;
    } else if (result === "unchanged") {
      unchanged += 1;
    } else if (result === "not_found") {
      skipped.push({ id, tipo, reason: "Cadastro não encontrado" });
    } else {
      skipped.push({ id, tipo, reason: "Dados inválidos ou sem alteração" });
    }
  }

  return { updated, unchanged, skipped };
}
