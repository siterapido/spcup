/**
 * Desvincula movimentações com pessoa stub e rematch.
 * Run: pnpm exec tsx scripts/rematch-desvincular-stubs.ts
 */
import {
  applyDeterministicMatch,
  isStubNome,
  MOVIMENTACAO_STATUS,
} from "@spc-up/core";
import { getDb, movimentacao } from "@spc-up/db";
import { config } from "dotenv";
import { eq, isNull } from "drizzle-orm";
import * as fs from "node:fs";

config();
if (fs.existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

async function main() {
  const db = getDb();
  const movs = await db.query.movimentacao.findMany({
    where: isNull(movimentacao.deletedAt),
    with: { pessoaFisica: true, pessoaJuridica: true },
  });
  let count = 0;
  for (const mov of movs) {
    const stubPf =
      mov.pessoaFisica && isStubNome("PF", mov.pessoaFisica.nome);
    const stubPj =
      mov.pessoaJuridica &&
      isStubNome("PJ", mov.pessoaJuridica.razaoSocial);
    if (!stubPf && !stubPj) continue;
    await db
      .update(movimentacao)
      .set({
        pessoaFisicaId: null,
        pessoaJuridicaId: null,
        status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
      })
      .where(eq(movimentacao.id, mov.id));
    await applyDeterministicMatch(db, mov.id);
    count += 1;
  }
  console.log(`Rematch ${count} movimentações com stub.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
