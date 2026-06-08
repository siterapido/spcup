import { describe, expect, it } from "vitest";

import {
  boundsForColumnIndex,
  clientFileKey,
  resolveColumnFromTextItems,
  resolveColumnIndexFromClick,
  autoDiscoverColumns,
  detectColunaDirecaoNoCabecalho,
} from "./extrato-column-map-client";

describe("clientFileKey", () => {
  it("is stable for same file metadata", () => {
    const f = new File(["x"], "a.pdf", { lastModified: 1 });
    expect(clientFileKey(f)).toBe(clientFileKey(f));
  });
});

describe("resolveColumnIndexFromClick", () => {
  it("bins click x into column index", () => {
    const idx = resolveColumnIndexFromClick({
      clickXNorm: 0.75,
      columnCount: 4,
    });
    expect(idx).toBe(3);
  });
});

describe("boundsForColumnIndex", () => {
  it("splits page into equal bands", () => {
    expect(boundsForColumnIndex(0, 4)).toEqual({ xInicio: 0, xFim: 0.25 });
    expect(boundsForColumnIndex(3, 4)).toEqual({ xInicio: 0.75, xFim: 1 });
  });
});

describe("resolveColumnFromTextItems", () => {
  it("picks nearest header cluster", () => {
    const result = resolveColumnFromTextItems(
      [
        { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
        { str: "Valor", transform: [1, 0, 0, 1, 80, 100] },
      ],
      85,
      100,
    );
    expect(result.colunaIndex).toBe(1);
    expect(result.headerLabel).toContain("Valor");
  });
});

describe("autoDiscoverColumns", () => {
  it("discovers columns automatically using header keywords and Y-coordinates", () => {
    const items = [
      { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Histórico", transform: [1, 0, 0, 1, 80, 100] },
      { str: "Valor", transform: [1, 0, 0, 1, 150, 100] },
      { str: "Saldo", transform: [1, 0, 0, 1, 220, 100] },
    ];
    const discovered = autoDiscoverColumns(items, 300);
    expect(discovered).toHaveLength(4);
    expect(discovered[0]!.campo).toBe("data");
    expect(discovered[1]!.campo).toBe("historico");
    expect(discovered[2]!.campo).toBe("valor");
    expect(discovered[3]!.campo).toBe("saldo");
  });

  it("maps Documento and CPF/CNPJ to separate fields", () => {
    const items = [
      { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Documento", transform: [1, 0, 0, 1, 80, 100] },
      { str: "CPF/CNPJ", transform: [1, 0, 0, 1, 150, 100] },
      { str: "Valor", transform: [1, 0, 0, 1, 220, 100] },
    ];
    const discovered = autoDiscoverColumns(items, 300);
    expect(discovered.find((e) => e.campo === "documento")?.headerLabel).toContain("Documento");
    expect(discovered.find((e) => e.campo === "cpf_cnpj")?.headerLabel).toContain("CPF");
  });

  it("discovers direcao column from D/C header", () => {
    const items = [
      { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Valor", transform: [1, 0, 0, 1, 80, 100] },
      { str: "D/C", transform: [1, 0, 0, 1, 150, 100] },
      { str: "Saldo", transform: [1, 0, 0, 1, 220, 100] },
    ];
    const discovered = autoDiscoverColumns(items, 300);
    expect(discovered.some((e) => e.campo === "direcao")).toBe(true);
  });
});

describe("detectColunaDirecaoNoCabecalho", () => {
  it("returns true when header has D/C keywords", () => {
    const items = [
      { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Cred/Dev", transform: [1, 0, 0, 1, 80, 100] },
    ];
    expect(detectColunaDirecaoNoCabecalho(items)).toBe(true);
  });

  it("returns false when no direcao keywords", () => {
    const items = [
      { str: "Data", transform: [1, 0, 0, 1, 10, 100] },
      { str: "Valor", transform: [1, 0, 0, 1, 80, 100] },
    ];
    expect(detectColunaDirecaoNoCabecalho(items)).toBe(false);
  });

  it("returns false for empty items", () => {
    expect(detectColunaDirecaoNoCabecalho([])).toBe(false);
  });
});
