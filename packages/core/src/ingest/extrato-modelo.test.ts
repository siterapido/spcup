import { describe, expect, it } from "vitest";
import { detectExtratoModeloFromFilename, extratoColumnMapForModelo } from "./extrato-modelo";
import {
  EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN,
  EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN,
} from "./extrato-column-map-fixtures";

describe("detectExtratoModeloFromFilename", () => {
  it("detecta caixa_pix", () => {
    expect(detectExtratoModeloFromFilename("Extrato Jan PIX (1).pdf")).toBe("caixa_pix");
  });

  it("detecta caixa_total", () => {
    expect(detectExtratoModeloFromFilename("EXTRATO TOTAL JANEIRO.pdf")).toBe("caixa_total");
  });

  it("retorna outro quando ambíguo", () => {
    expect(detectExtratoModeloFromFilename("extrato-janeiro.pdf")).toBe("outro");
  });
});

describe("extratoColumnMapForModelo", () => {
  it("retorna mapa para caixa_pix", () => {
    expect(extratoColumnMapForModelo("caixa_pix")).toBe(EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN);
  });

  it("retorna mapa para caixa_total", () => {
    expect(extratoColumnMapForModelo("caixa_total")).toBe(EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN);
  });

  it("retorna undefined para outro", () => {
    expect(extratoColumnMapForModelo("outro")).toBeUndefined();
  });
});
