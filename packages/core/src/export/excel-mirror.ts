import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";

import { movimentacao, movimentacaoSpca, type Db } from "@spc-up/db";

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

  const workbook = new ExcelJS.Workbook();
  const origem = workbook.addWorksheet("Origem");
  origem.addRow([
    "data",
    "valor",
    "direcao",
    "descricao",
    "fonte_recurso",
    "natureza_recurso",
    "tipo_origem_recurso",
    "classificacao_receita",
  ]);

  const aplicacao = workbook.addWorksheet("Aplicacao");
  aplicacao.addRow([
    "data",
    "valor",
    "direcao",
    "descricao",
    "cd_descricao_gasto",
    "tipo_documento",
    "nr_documento",
  ]);

  const doacao = workbook.addWorksheet("Doacao");
  doacao.addRow(["data", "valor", "descricao", "nr_recibo_doacao"]);

  for (const { mov, spca } of rows) {
    if (mov.direcao === "ENTRADA") {
      origem.addRow([
        mov.dataMovimento,
        mov.valor,
        mov.direcao,
        mov.descricaoRaw,
        spca?.fonteRecurso ?? "",
        spca?.naturezaRecurso ?? "",
        spca?.tipoOrigemRecurso ?? "",
        spca?.classificacaoReceita ?? "",
      ]);
      if (spca?.nrReciboDoacao) {
        doacao.addRow([
          mov.dataMovimento,
          mov.valor,
          mov.descricaoRaw,
          spca.nrReciboDoacao,
        ]);
      }
    } else {
      aplicacao.addRow([
        mov.dataMovimento,
        mov.valor,
        mov.direcao,
        mov.descricaoRaw,
        spca?.cdDescricaoGasto ?? "",
        spca?.tipoDocumento ?? "",
        spca?.nrDocumento ?? "",
      ]);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
