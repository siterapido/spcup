import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { parseCadastroTipo } from "./constants";
import {
  extractSpreadsheetHeaders,
  parseCadastroSpreadsheet,
  suggestCadastroColumnMap,
} from "./parse";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(fixtureDir, "../../fixtures/cadastro-sample.xlsx");
const ALIAS_FIXTURE_PATH = path.join(fixtureDir, "../../fixtures/cadastro-alias.xlsx");

beforeAll(async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cadastro");
  sheet.addRow(["tipo", "documento", "nome"]);
  sheet.addRow(["PF", "123.456.789-09", "Joao Silva"]);
  sheet.addRow(["PJ", "11.222.333/0001-81", "Empresa Teste LTDA"]);
  sheet.addRow(["XX", "12345678909", "Invalido"]);
  await workbook.xlsx.writeFile(FIXTURE_PATH);

  const aliasWorkbook = new ExcelJS.Workbook();
  const aliasSheet = aliasWorkbook.addWorksheet("Cadastro");
  aliasSheet.addRow(["CPF/CNPJ", "Razão Social"]);
  aliasSheet.addRow(["12345678909", "Maria Souza"]);
  aliasSheet.addRow(["11222333000181", "Empresa Alias LTDA"]);
  await aliasWorkbook.xlsx.writeFile(ALIAS_FIXTURE_PATH);
});

describe("parseCadastroTipo", () => {
  it("accepts Portuguese labels with accents", () => {
    expect(parseCadastroTipo("Pessoa Física")).toBe("PF");
    expect(parseCadastroTipo("Pessoa Jurídica")).toBe("PJ");
  });
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

  it("suggests aliases for common headers", async () => {
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(ALIAS_FIXTURE_PATH);
    const preview = await extractSpreadsheetHeaders(buf, "cadastro-alias.xlsx");
    expect(preview.headers).toEqual(["CPF/CNPJ", "Razão Social"]);
    expect(suggestCadastroColumnMap(preview.headers)).toEqual({
      documento: "CPF/CNPJ",
      nome: "Razão Social",
    });

    const result = await parseCadastroSpreadsheet(buf, "cadastro-alias.xlsx", {
      documento: "CPF/CNPJ",
      nome: "Razão Social",
    });
    expect(result.ok).toHaveLength(2);
    expect(result.ok[0]?.tipo).toBe("PF");
    expect(result.ok[1]?.tipo).toBe("PJ");
  });

  it("rejects buffer without required headers when unmapped", async () => {
    const csv = Buffer.from("foo,bar\n1,2", "utf8");
    await expect(parseCadastroSpreadsheet(csv, "bad.csv")).rejects.toThrow(/documento/i);
  });

  it("parses xlsx without header row (nome | documento | tipo)", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pessoas");
    sheet.addRow(["Maria Souza", "123.456.789-09", "Pessoa Física", "Validado"]);
    sheet.addRow(["Empresa Alias LTDA", "11.222.333/0001-81", "Pessoa Jurídica", ""]);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await extractSpreadsheetHeaders(buf, "sem-cabecalho.xlsx");
    expect(preview.headerless).toBe(true);
    expect(preview.suggestedMap).toMatchObject({
      nome: "nome",
      documento: "documento",
      tipo: "tipo",
    });

    const result = await parseCadastroSpreadsheet(buf, "sem-cabecalho.xlsx", {
      documento: "documento",
      nome: "nome",
      tipo: "tipo",
    });
    expect(result.ok).toHaveLength(2);
    expect(result.ok[0]?.nome).toBe("MARIA SOUZA");
    expect(result.ok[1]?.tipo).toBe("PJ");
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
