/**
 * Seed all 27 UFs with placeholder CNPJs — replace before production export.
 * Run: pnpm seed:diretorios
 */
import { diretorioEstadual, getDb } from "@spc-up/db";
import { eq } from "drizzle-orm";

// SUBSTITUIR pelos CNPJs reais de cada diretório estadual da UP antes do piloto SPCA.
const UFS: ReadonlyArray<readonly [uf: string, cnpj: string, nome: string]> = [
  ["AC", "00000000000100", "Diretório Estadual UP — Acre"],
  ["AL", "00000000000101", "Diretório Estadual UP — Alagoas"],
  ["AP", "00000000000102", "Diretório Estadual UP — Amapá"],
  ["AM", "00000000000103", "Diretório Estadual UP — Amazonas"],
  ["BA", "00000000000104", "Diretório Estadual UP — Bahia"],
  ["CE", "00000000000105", "Diretório Estadual UP — Ceará"],
  ["DF", "00000000000106", "Diretório Estadual UP — Distrito Federal"],
  ["ES", "00000000000107", "Diretório Estadual UP — Espírito Santo"],
  ["GO", "00000000000108", "Diretório Estadual UP — Goiás"],
  ["MA", "00000000000109", "Diretório Estadual UP — Maranhão"],
  ["MT", "00000000000110", "Diretório Estadual UP — Mato Grosso"],
  ["MS", "00000000000111", "Diretório Estadual UP — Mato Grosso do Sul"],
  ["MG", "00000000000112", "Diretório Estadual UP — Minas Gerais"],
  ["PA", "00000000000113", "Diretório Estadual UP — Pará"],
  ["PB", "00000000000114", "Diretório Estadual UP — Paraíba"],
  ["PR", "00000000000115", "Diretório Estadual UP — Paraná"],
  ["PE", "00000000000116", "Diretório Estadual UP — Pernambuco"],
  ["PI", "00000000000117", "Diretório Estadual UP — Piauí"],
  ["RJ", "00000000000118", "Diretório Estadual UP — Rio de Janeiro"],
  ["RN", "00000000000119", "Diretório Estadual UP — Rio Grande do Norte"],
  ["RS", "00000000000120", "Diretório Estadual UP — Rio Grande do Sul"],
  ["RO", "00000000000121", "Diretório Estadual UP — Rondônia"],
  ["RR", "00000000000122", "Diretório Estadual UP — Roraima"],
  ["SC", "00000000000123", "Diretório Estadual UP — Santa Catarina"],
  ["SP", "00000000000124", "Diretório Estadual UP — São Paulo"],
  ["SE", "00000000000125", "Diretório Estadual UP — Sergipe"],
  ["TO", "00000000000126", "Diretório Estadual UP — Tocantins"],
] as const;

function validateSeedData(): void {
  if (UFS.length !== 27) {
    throw new Error(`Esperadas 27 UFs, encontradas ${UFS.length}`);
  }
  const seen = new Set<string>();
  for (const [uf, cnpj, nome] of UFS) {
    if (uf.length !== 2) throw new Error(`UF inválida: ${uf}`);
    if (cnpj.length !== 14) throw new Error(`CNPJ inválido para ${uf}: ${cnpj}`);
    if (!nome.trim()) throw new Error(`Nome vazio para ${uf}`);
    if (seen.has(uf)) throw new Error(`UF duplicada: ${uf}`);
    seen.add(uf);
  }
}

function dryRun(): void {
  validateSeedData();
  console.log(`DRY RUN (sem DATABASE_URL): ${UFS.length} diretórios seriam upsertados por UF.`);
  console.log(`UFs: ${UFS.map(([uf]) => uf).join(", ")}`);
  console.log("IMPORTANTE: substitua CNPJs placeholder pelos CNPJs reais antes de exportar ao SPCA.");
}

async function seed(): Promise<void> {
  validateSeedData();
  const db = getDb();
  let created = 0;
  let updated = 0;

  for (const [uf, cnpj, nome] of UFS) {
    const existing = await db.query.diretorioEstadual.findFirst({
      where: eq(diretorioEstadual.uf, uf),
    });

    if (existing) {
      await db
        .update(diretorioEstadual)
        .set({ cnpjPrestador: cnpj, nome, ativo: true, updatedAt: new Date() })
        .where(eq(diretorioEstadual.id, existing.id));
      updated += 1;
    } else {
      await db.insert(diretorioEstadual).values({
        uf,
        cnpjPrestador: cnpj,
        nome,
        ativo: true,
      });
      created += 1;
    }
  }

  console.log(`Seed concluído: ${created} criados, ${updated} atualizados.`);
  console.log("IMPORTANTE: substitua CNPJs placeholder pelos CNPJs reais antes de exportar ao SPCA.");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    dryRun();
    return;
  }
  await seed();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
