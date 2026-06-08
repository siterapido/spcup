import { type Db, pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { eq } from "drizzle-orm";

import type { CadastroTipo } from "./constants";

export type PessoaRef = { id: string; tipo: CadastroTipo };

export type DeletePessoasSkipped = PessoaRef & { reason: string };

export type DeletePessoasResult = {
  deleted: number;
  skipped: DeletePessoasSkipped[];
};

export async function deletePessoas(
  db: Db,
  items: PessoaRef[],
): Promise<DeletePessoasResult> {
  const skipped: DeletePessoasSkipped[] = [];
  let deleted = 0;
  const seen = new Set<string>();
  const now = new Date();

  for (const item of items) {
    const key = `${item.tipo}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (item.tipo === "PF") {
      const rows = await db
        .select({ id: pessoaFisica.id, deletedAt: pessoaFisica.deletedAt })
        .from(pessoaFisica)
        .where(eq(pessoaFisica.id, item.id))
        .limit(1);
      const existing = rows[0];
      if (!existing) {
        skipped.push({ ...item, reason: "Cadastro não encontrado" });
        continue;
      }
      if (existing.deletedAt != null) {
        skipped.push({ ...item, reason: "Cadastro já excluído" });
        continue;
      }
      await db
        .update(pessoaFisica)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(pessoaFisica.id, item.id));
    } else {
      const rows = await db
        .select({ id: pessoaJuridica.id, deletedAt: pessoaJuridica.deletedAt })
        .from(pessoaJuridica)
        .where(eq(pessoaJuridica.id, item.id))
        .limit(1);
      const existing = rows[0];
      if (!existing) {
        skipped.push({ ...item, reason: "Cadastro não encontrado" });
        continue;
      }
      if (existing.deletedAt != null) {
        skipped.push({ ...item, reason: "Cadastro já excluído" });
        continue;
      }
      await db
        .update(pessoaJuridica)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(pessoaJuridica.id, item.id));
    }

    deleted += 1;
  }

  return { deleted, skipped };
}
