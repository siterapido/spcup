import path from "node:path";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { parseCadastroTipo } from "./constants";
import {
  cellToText,
  extractSpreadsheetHeaders,
  inferHeaderlessColumnIndex,
  parseCadastroSpreadsheet,
  prepareDocumentoRaw,
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

describe("cellToText", () => {
  it("pads numeric CPF missing leading zeros", () => {
    expect(cellToText(1234567890)).toBe("01234567890");
  });

  it("strips trailing decimal from document string", () => {
    expect(cellToText("12345678909.0")).toBe("12345678909");
    expect(cellToText("11222333000181,00")).toBe("11222333000181");
  });

  it("parses scientific notation strings", () => {
    expect(cellToText("1.2345678909e10")).toBe("12345678909");
  });
});

describe("prepareDocumentoRaw", () => {
  it("pads short CPF to 11 digits", () => {
    const r = prepareDocumentoRaw("12345678909");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("strips mask from CPF", () => {
    const r = prepareDocumentoRaw("123.456.789-09");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("strips CPF label prefix", () => {
    const r = prepareDocumentoRaw("CPF: 123.456.789-09");
    expect(r.documento).toBe("12345678909");
  });

  it("pads numeric CPF missing leading zeros", () => {
    const r = prepareDocumentoRaw("34567890");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("00034567890");
  });

  it("strips decimal suffix from string document", () => {
    const r = prepareDocumentoRaw("11222333000181.0");
    expect(r.tipo).toBe("PJ");
    expect(r.documento).toBe("11222333000181");
  });

  it("infers PJ for 14-char cleaned doc", () => {
    const r = prepareDocumentoRaw("11.222.333/0001-81");
    expect(r.tipo).toBe("PJ");
    expect(r.documento).toBe("11222333000181");
  });

  it("respects explicit tipo PF", () => {
    const r = prepareDocumentoRaw("12345678909", "PF");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("12345678909");
  });

  it("throws on empty document", () => {
    expect(() => prepareDocumentoRaw("")).toThrow(/vazio/i);
  });

  it("pads 7-digit CPF fragment to 11 digits", () => {
    const r = prepareDocumentoRaw("1234567");
    expect(r.tipo).toBe("PF");
    expect(r.documento).toBe("00001234567");
  });

  it("throws when document exceeds 14 alnum chars", () => {
    expect(() => prepareDocumentoRaw("123456789012345")).toThrow(/tamanho inválido/i);
  });
});

describe("inferHeaderlessColumnIndex", () => {
  it("detects documento in first column", () => {
    expect(inferHeaderlessColumnIndex(["123.456.789-09", "Maria Souza"])).toEqual({
      documento: 0,
      nome: 1,
      tipo: undefined,
    });
  });
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

  it("maps CPF.CNPJ header to documento", () => {
    expect(suggestCadastroColumnMap(["CPF.CNPJ", "Nome"])).toMatchObject({
      documento: "CPF.CNPJ",
      nome: "Nome",
    });
  });

  it("maps Nº Documento header to documento", () => {
    expect(suggestCadastroColumnMap(["Nº Documento", "Nome"])).toMatchObject({
      documento: "Nº Documento",
      nome: "Nome",
    });
  });

  it("returns size error when tipo PJ and doc has 11 digits", async () => {
    const csv = Buffer.from(
      "tipo;documento;nome\nPJ;12345678909;Empresa Teste\n",
      "utf8",
    );
    const result = await parseCadastroSpreadsheet(csv, "tipo-pj-cpf.csv");
    expect(result.ok).toHaveLength(0);
    expect(result.erros[0]?.motivo).toMatch(/tamanho inválido/i);
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

  it("parses headerless xlsx with documento before nome", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pessoas");
    sheet.addRow(["123.456.789-09", "Maria Souza"]);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await extractSpreadsheetHeaders(buf, "doc-primeiro.xlsx");
    expect(preview.headerless).toBe(true);

    const result = await parseCadastroSpreadsheet(buf, "doc-primeiro.xlsx", {
      documento: "documento",
      nome: "nome",
    });
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.documento).toBe("12345678909");
    expect(result.ok[0]?.nome).toBe("MARIA SOUZA");
  });

  it("parses headerless xlsx with numeric documento cell", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pessoas");
    sheet.addRow([12345678909, "Maria Souza"]);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseCadastroSpreadsheet(buf, "doc-numero.xlsx", {
      documento: "documento",
      nome: "nome",
    });
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.documento).toBe("12345678909");
  });

  it("parses xlsx with short numeric CPF cell", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Pessoas");
    sheet.addRow(["nome", "documento"]);
    sheet.addRow(["Maria Souza", 12345678909]);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parseCadastroSpreadsheet(buf, "cpf-curto.xlsx", {
      documento: "documento",
      nome: "nome",
    });
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.tipo).toBe("PF");
    expect(result.ok[0]?.documento).toBe("12345678909");
  });

  it("imports CPF with incorrect check digits from spreadsheet", async () => {
    const csv = Buffer.from(
      "documento;nome\n04665823828;Vitoria A Monteiro\n",
      "utf8",
    );
    const result = await parseCadastroSpreadsheet(csv, "cpf-sem-dv.csv", {
      documento: "documento",
      nome: "nome",
    });
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]?.documento).toBe("04665823828");
    expect(result.erros).toHaveLength(0);
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
