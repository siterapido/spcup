import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { parseCadastroSpreadsheet } from "./parse";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(fixtureDir, "../../fixtures/cadastro-sample.xlsx");

beforeAll(async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cadastro");
  sheet.addRow(["tipo", "documento", "nome"]);
  sheet.addRow(["PF", "123.456.789-09", "Joao Silva"]);
  sheet.addRow(["PJ", "11.222.333/0001-81", "Empresa Teste LTDA"]);
  sheet.addRow(["XX", "12345678909", "Invalido"]);
  await workbook.xlsx.writeFile(FIXTURE_PATH);
});

describe("parseCadastroSpreadsheet", () => {
  it("parses xlsx with tipo documento nome", async () => {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(FIXTURE_PATH);
    const result = await parseCadastroSpreadsheet(buf, "cadastro-sample.xlsx");
    expect(result.ok).toHaveLength(2);
    expect(result.ok[0]?.tipo).toBe("PF");
    expect(result.ok[0]?.documento).toBe("12345678909");
    expect(result.ok[1]?.tipo).toBe("PJ");
    expect(result.erros).toHaveLength(1);
    expect(result.erros[0]?.linha).toBe(4);
  });

  it("rejects buffer without required headers", async () => {
    const csv = Buffer.from("foo,bar\n1,2", "utf8");
    await expect(parseCadastroSpreadsheet(csv, "bad.csv")).rejects.toThrow(/tipo/i);
  });

  it("parses csv with semicolon delimiter", async () => {
    const csv = Buffer.from(
      "tipo;documento;nome\nPF;12345678909;Maria Souza\n",
      "utf8",
    );
    const result = await parseCadastroSpreadsheet(csv, "cadastro.csv");
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.nome).toBe("MARIA SOUZA");
  });
});
