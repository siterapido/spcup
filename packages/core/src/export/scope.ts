import { and, eq } from "drizzle-orm";

import { movimentacao } from "@spc-up/db";

/** Filter movimentações by prestador CNPJ and exercício. */
export function scopePrestadorExercicio(cnpjPrestador: string, exercicio: number) {
  return and(
    eq(movimentacao.cnpjPrestador, cnpjPrestador),
    eq(movimentacao.exercicio, exercicio),
  );
}
