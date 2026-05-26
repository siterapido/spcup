import { diretorioMunicipal, type Db, type DiretorioMunicipal } from "@spc-up/db";
import { and, asc, eq, ilike } from "drizzle-orm";

import { normalizeCnpj } from "../normalize";

export interface DiretorioMunicipalInput {
  uf: string;
  codigoIbge?: string | null;
  nomeMunicipio: string;
  cnpjPrestador: string;
  ativo?: boolean;
}

export interface ImportMunicipalRow {
  uf: string;
  codigo_ibge?: string;
  nome_municipio: string;
  cnpj_prestador: string;
}

export async function listDiretoriosMunicipais(
  db: Db,
  uf: string,
  options?: { q?: string; ativoOnly?: boolean },
): Promise<DiretorioMunicipal[]> {
  const ufUpper = uf.toUpperCase();
  const conditions = [eq(diretorioMunicipal.uf, ufUpper)];
  if (options?.ativoOnly !== false) {
    conditions.push(eq(diretorioMunicipal.ativo, true));
  }
  if (options?.q?.trim()) {
    conditions.push(ilike(diretorioMunicipal.nomeMunicipio, `%${options.q.trim()}%`));
  }
  return db
    .select()
    .from(diretorioMunicipal)
    .where(and(...conditions))
    .orderBy(asc(diretorioMunicipal.nomeMunicipio));
}

export async function upsertDiretorioMunicipal(
  db: Db,
  input: DiretorioMunicipalInput,
): Promise<DiretorioMunicipal> {
  const cnpj = normalizeCnpj(input.cnpjPrestador);
  const uf = input.uf.toUpperCase();

  const existing = await db.query.diretorioMunicipal.findFirst({
    where: eq(diretorioMunicipal.cnpjPrestador, cnpj),
  });

  if (existing) {
    const [updated] = await db
      .update(diretorioMunicipal)
      .set({
        uf,
        codigoIbge: input.codigoIbge ?? null,
        nomeMunicipio: input.nomeMunicipio,
        ativo: input.ativo ?? true,
        updatedAt: new Date(),
      })
      .where(eq(diretorioMunicipal.id, existing.id))
      .returning();
    if (!updated) {
      throw new Error("Falha ao atualizar diretório municipal");
    }
    return updated;
  }

  const [created] = await db
    .insert(diretorioMunicipal)
    .values({
      uf,
      codigoIbge: input.codigoIbge ?? null,
      nomeMunicipio: input.nomeMunicipio,
      cnpjPrestador: cnpj,
      ativo: input.ativo ?? true,
    })
    .returning();
  if (!created) {
    throw new Error("Falha ao criar diretório municipal");
  }
  return created;
}

export async function importDiretoriosMunicipais(
  db: Db,
  rows: ImportMunicipalRow[],
): Promise<{ criados: number; atualizados: number; erros: string[] }> {
  let criados = 0;
  let atualizados = 0;
  const erros: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    try {
      const cnpj = normalizeCnpj(row.cnpj_prestador);
      const existing = await db.query.diretorioMunicipal.findFirst({
        where: eq(diretorioMunicipal.cnpjPrestador, cnpj),
      });
      await upsertDiretorioMunicipal(db, {
        uf: row.uf,
        codigoIbge: row.codigo_ibge,
        nomeMunicipio: row.nome_municipio,
        cnpjPrestador: cnpj,
      });
      if (existing) {
        atualizados += 1;
      } else {
        criados += 1;
      }
    } catch (error) {
      erros.push(`Linha ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { criados, atualizados, erros };
}
