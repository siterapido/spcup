import { and, eq } from "drizzle-orm";

import { movimentacao, movimentacaoSpca, type Db } from "@spc-up/db";

import {
  appendExcelMirrorRows,
  createExcelMirrorWorkbook,
  writeExcelMirrorWorkbook,
} from "./excel-mirror-worksheet";
import { scopePrestadorExercicio } from "./scope";

/** Build Excel workbook mirroring SPCA fields for audit (confirmed/exported rows). */
export async function buildExcelMirrorBuffer(
  db: Db,
  cnpjPrestador: string,
  exercicio: number,
): Promise<Buffer> {
  const rows = await db
    .select({
      mov: movimentacao,
      spca: movimentacaoSpca,
    })
    .from(movimentacao)
    .leftJoin(movimentacaoSpca, eq(movimentacaoSpca.movimentacaoId, movimentacao.id))
    .where(
      and(
        scopePrestadorExercicio(cnpjPrestador, exercicio),
        eq(movimentacao.status, "CONFIRMADO"),
      ),
    );

  const { workbook, sheets } = createExcelMirrorWorkbook();
  appendExcelMirrorRows(sheets, rows);
  return writeExcelMirrorWorkbook(workbook);
}
