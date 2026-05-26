import { diretorioEstadual, type Db, type DiretorioEstadual } from "@spc-up/db";
import { asc, eq } from "drizzle-orm";

import { normalizeCnpj } from "../normalize";
import { isValidUf } from "./constants";

export interface DiretorioEstadualInput {
  uf: string;
  cnpjPrestador: string;
  nome: string;
  ativo?: boolean;
}

export interface ImportEstadualRow {
  uf: string;
  cnpj_prestador: string;
  nome: string;
}

export async function listDiretoriosEstaduais(
  db: Db,
  options?: { ativoOnly?: boolean },
): Promise<DiretorioEstadual[]> {
  const rows = await db.select().from(diretorioEstadual).orderBy(asc(diretorioEstadual.uf));
  if (options?.ativoOnly === false) return rows;
  return rows.filter((r) => r.ativo);
}

export async function getDiretorioEstadualByUf(
  db: Db,
  uf: string,
): Promise<DiretorioEstadual | undefined> {
  return db.query.diretorioEstadual.findFirst({
    where: eq(diretorioEstadual.uf, uf.toUpperCase()),
  });
}

export async function upsertDiretorioEstadualByUf(
  db: Db,
  input: DiretorioEstadualInput,
): Promise<DiretorioEstadual> {
  const uf = input.uf.toUpperCase();
  if (!isValidUf(uf)) throw new Error(`UF inválida: ${uf}`);
  const cnpj = normalizeCnpj(input.cnpjPrestador);

  const existing = await getDiretorioEstadualByUf(db, uf);
  if (existing) {
    const [updated] = await db
      .update(diretorioEstadual)
      .set({
        cnpjPrestador: cnpj,
        nome: input.nome,
        ativo: input.ativo ?? true,
        updatedAt: new Date(),
      })
      .where(eq(diretorioEstadual.id, existing.id))
      .returning();
    if (!updated) throw new Error("Falha ao atualizar diretório estadual");
    return updated;
  }

  const [created] = await db
    .insert(diretorioEstadual)
    .values({ uf, cnpjPrestador: cnpj, nome: input.nome, ativo: input.ativo ?? true })
    .returning();
  if (!created) throw new Error("Falha ao criar diretório estadual");
  return created;
}

export async function updateDiretorioEstadualById(
  db: Db,
  id: string,
  input: Partial<DiretorioEstadualInput>,
): Promise<DiretorioEstadual> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.cnpjPrestador != null) patch.cnpjPrestador = normalizeCnpj(input.cnpjPrestador);
  if (input.nome != null) patch.nome = input.nome;
  if (input.ativo != null) patch.ativo = input.ativo;
  const [updated] = await db
    .update(diretorioEstadual)
    .set(patch)
    .where(eq(diretorioEstadual.id, id))
    .returning();
  if (!updated) throw new Error("Diretório estadual não encontrado");
  return updated;
}

export async function importDiretoriosEstaduais(
  db: Db,
  rows: ImportEstadualRow[],
): Promise<{ atualizados: number; erros: Array<{ linha: number; motivo: string }> }> {
  let atualizados = 0;
  const erros: Array<{ linha: number; motivo: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await upsertDiretorioEstadualByUf(db, {
        uf: rows[i]!.uf,
        cnpjPrestador: rows[i]!.cnpj_prestador,
        nome: rows[i]!.nome,
      });
      atualizados += 1;
    } catch (error) {
      erros.push({
        linha: i + 1,
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { atualizados, erros };
}
