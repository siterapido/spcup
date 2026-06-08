import ExcelJS from "exceljs";

import type { MovimentacaoAprovadaItem } from "./types";

export const MOVIMENTACOES_EXPORT_COLUMNS = [
  "id",
  "data_movimento",
  "valor",
  "direcao",
  "pessoa_nome",
  "pessoa_documento",
  "cnpj_prestador",
  "prestador_nome",
  "descricao_raw",
  "uf",
  "status",
  "sessao_prestacao_id",
  "confianca_global",
  "nome_arquivo",
  "cred_dev",
] as const;

function rowToValues(item: MovimentacaoAprovadaItem): string[] {
  return [
    item.id,
    item.data_movimento,
    item.valor,
    item.direcao,
    item.pessoa_nome ?? "",
    item.pessoa_documento ?? "",
    item.cnpj_prestador,
    item.prestador_nome ?? "",
    item.descricao_raw,
    item.uf,
    item.status,
    item.sessao_prestacao_id ?? "",
    String(item.confianca_global),
    item.nome_arquivo ?? "",
    item.cred_dev ?? "",
  ];
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** CSV UTF-8 with BOM for approved movimentações list export. */
export function buildMovimentacoesCsvBuffer(
  rows: MovimentacaoAprovadaItem[],
): Buffer {
  const header = MOVIMENTACOES_EXPORT_COLUMNS.join(",");
  const lines = rows.map((row) =>
    rowToValues(row).map(escapeCsvCell).join(","),
  );
  const body = [header, ...lines].join("\r\n");
  return Buffer.from(`\uFEFF${body}`, "utf8");
}

/** XLSX with operational columns for approved movimentações list export. */
export async function buildMovimentacoesXlsxBuffer(
  rows: MovimentacaoAprovadaItem[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Movimentacoes");
  sheet.addRow([...MOVIMENTACOES_EXPORT_COLUMNS]);
  for (const row of rows) {
    sheet.addRow(rowToValues(row));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
