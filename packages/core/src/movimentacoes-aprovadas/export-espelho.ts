import { and, eq, inArray, isNull } from "drizzle-orm";

import { movimentacao, movimentacaoSpca, type Db } from "@spc-up/db";

import {
  appendExcelMirrorRows,
  createExcelMirrorWorkbook,
  writeExcelMirrorWorkbook,
} from "../export/excel-mirror-worksheet";
import { APPROVED_STATUSES } from "./list";

/** SPCA mirror workbook (Origem/Aplicação/Doação) for a subset of movimentação IDs. */
export async function buildEspelhoSpcaBufferForMovimentacaoIds(
  db: Db,
  ids: string[],
): Promise<Buffer> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    const { workbook } = createExcelMirrorWorkbook();
    return writeExcelMirrorWorkbook(workbook);
  }

  const rows = await db
    .select({
      mov: movimentacao,
      spca: movimentacaoSpca,
    })
    .from(movimentacao)
    .leftJoin(movimentacaoSpca, eq(movimentacaoSpca.movimentacaoId, movimentacao.id))
    .where(
      and(
        inArray(movimentacao.id, uniqueIds),
        isNull(movimentacao.deletedAt),
        isNull(movimentacao.movimentacaoCanonicaId),
        inArray(movimentacao.status, [...APPROVED_STATUSES]),
      ),
    );

  const { workbook, sheets } = createExcelMirrorWorkbook();
  appendExcelMirrorRows(sheets, rows);
  return writeExcelMirrorWorkbook(workbook);
}
