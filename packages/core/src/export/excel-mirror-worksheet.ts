import ExcelJS from "exceljs";

import type { Movimentacao, MovimentacaoSpca } from "@spc-up/db";

export type ExcelMirrorRow = {
  mov: Pick<
    Movimentacao,
    "dataMovimento" | "valor" | "direcao" | "descricaoRaw" | "credDev"
  >;
  spca: Pick<
    MovimentacaoSpca,
    | "fonteRecurso"
    | "naturezaRecurso"
    | "tipoOrigemRecurso"
    | "classificacaoReceita"
    | "cdDescricaoGasto"
    | "tipoDocumento"
    | "nrDocumento"
    | "nrReciboDoacao"
  > | null;
};

export type ExcelMirrorSheets = {
  origem: ExcelJS.Worksheet;
  aplicacao: ExcelJS.Worksheet;
  doacao: ExcelJS.Worksheet;
};

export function createExcelMirrorWorkbook(): {
  workbook: ExcelJS.Workbook;
  sheets: ExcelMirrorSheets;
} {
  const workbook = new ExcelJS.Workbook();
  const origem = workbook.addWorksheet("Origem");
  origem.addRow([
    "data",
    "valor",
    "direcao",
    "descricao",
    "cred_dev",
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
    "cred_dev",
    "cd_descricao_gasto",
    "tipo_documento",
    "nr_documento",
  ]);

  const doacao = workbook.addWorksheet("Doacao");
  doacao.addRow(["data", "valor", "descricao", "nr_recibo_doacao"]);

  return { workbook, sheets: { origem, aplicacao, doacao } };
}

export function appendExcelMirrorRows(
  sheets: ExcelMirrorSheets,
  rows: ExcelMirrorRow[],
): void {
  for (const { mov, spca } of rows) {
    if (mov.direcao === "ENTRADA") {
      sheets.origem.addRow([
        mov.dataMovimento,
        mov.valor,
        mov.direcao,
        mov.descricaoRaw,
        mov.credDev ?? "",
        spca?.fonteRecurso ?? "",
        spca?.naturezaRecurso ?? "",
        spca?.tipoOrigemRecurso ?? "",
        spca?.classificacaoReceita ?? "",
      ]);
      if (spca?.nrReciboDoacao) {
        sheets.doacao.addRow([
          mov.dataMovimento,
          mov.valor,
          mov.descricaoRaw,
          spca.nrReciboDoacao,
        ]);
      }
    } else {
      sheets.aplicacao.addRow([
        mov.dataMovimento,
        mov.valor,
        mov.direcao,
        mov.descricaoRaw,
        mov.credDev ?? "",
        spca?.cdDescricaoGasto ?? "",
        spca?.tipoDocumento ?? "",
        spca?.nrDocumento ?? "",
      ]);
    }
  }
}

export async function writeExcelMirrorWorkbook(
  workbook: ExcelJS.Workbook,
): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
