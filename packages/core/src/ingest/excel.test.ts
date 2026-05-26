import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { parseExcel } from "./excel";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(fixtureDir, "../../fixtures/sample.xlsx");

async function writeSampleXlsx(target: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Extrato");
  sheet.addRow(["data", "valor", "descricao", "tipo"]);
  sheet.addRow([new Date(Date.UTC(2025, 0, 10)), 1500.5, "Recebimento doacao", "C"]);
  sheet.addRow([new Date(Date.UTC(2025, 0, 11)), -320, "Pagamento fornecedor", "D"]);
  sheet.addRow([new Date(Date.UTC(2025, 0, 12)), 80, "Tarifa sem tipo", null]);
  await workbook.xlsx.writeFile(target);
}

beforeAll(async () => {
  await writeSampleXlsx(FIXTURE_PATH);
});

describe("parseExcel", () => {
  it("parses entrada and saida directions", async () => {
    const rows = await parseExcel(FIXTURE_PATH);
    expect(rows.some((r) => r.direcao === "ENTRADA")).toBe(true);
    expect(rows.some((r) => r.direcao === "SAIDA")).toBe(true);
  });

  it("returns expected fields", async () => {
    const rows = await parseExcel(FIXTURE_PATH);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.nrExtratoBancario).toBeNull();
      expect(row.valor).toMatch(/^\d+\.\d{2}$/);
      expect(row.direcao).toMatch(/^(ENTRADA|SAIDA)$/);
    }
  });

  it("infers direction from tipo and sign", async () => {
    const rows = await parseExcel(FIXTURE_PATH);
    const byDesc = Object.fromEntries(rows.map((row) => [row.descricaoRaw, row]));

    expect(byDesc["Recebimento doacao"]).toMatchObject({
      direcao: "ENTRADA",
      valor: "1500.50",
    });
    expect(byDesc["Pagamento fornecedor"]).toMatchObject({
      direcao: "SAIDA",
      valor: "320.00",
    });
    expect(byDesc["Tarifa sem tipo"]).toMatchObject({
      direcao: "ENTRADA",
      valor: "80.00",
    });
  });

  it("rejects missing required columns", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "spc-up-excel-"));
    const badPath = path.join(tmpDir, "bad.xlsx");
    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Sheet1");
      sheet.addRow(["data", "valor"]);
      sheet.addRow([new Date(Date.UTC(2025, 0, 1)), 10]);
      await workbook.xlsx.writeFile(badPath);

      await expect(parseExcel(badPath)).rejects.toThrow(/descricao/i);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
