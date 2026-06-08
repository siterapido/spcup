import { describe, expect, it } from "vitest";

import {
  buildExtratoColumnPromptHint,
  parseExtratoColumnMap,
  validateExtratoColumnMap,
  validateExtratoColumnMapPerPdf,
  validateExtratoColumnMapsSession,
} from "./extrato-column-map";

const validColunas = [
  { campo: "data", colunaIndex: 0 },
  { campo: "valor", colunaIndex: 1 },
  { campo: "documento", colunaIndex: 2 },
  { campo: "remetente_destinatario", colunaIndex: 3 },
  { campo: "historico", colunaIndex: 4 },
];

describe("validateExtratoColumnMap", () => {
  const base = {
    paginaReferencia: 1 as const,
    colunas: validColunas,
    inferirDirecaoDoValor: true,
  };

  it("accepts all five required fields with inferirDirecaoDoValor", () => {
    expect(validateExtratoColumnMap(base).ok).toBe(true);
  });

  it("accepts mapped direcao instead of inferirDirecaoDoValor", () => {
    expect(
      validateExtratoColumnMap({
        paginaReferencia: 1,
        colunas: [...validColunas, { campo: "direcao", colunaIndex: 5 }],
      }).ok,
    ).toBe(true);
  });

  it("rejects missing data", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: validColunas.filter((c) => c.campo !== "data"),
    });
    expect(r.ok).toBe(false);
  });

  it("rejects missing remetente_destinatario on single map", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: validColunas.filter((c) => c.campo !== "remetente_destinatario"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("remetente_destinatario");
  });

  it("rejects missing historico on single map", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: validColunas.filter((c) => c.campo !== "historico"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("historico");
  });

  it("rejects missing documento on single map", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: validColunas.filter((c) => c.campo !== "documento"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("documento");
  });

  it("rejects missing direcao when inferirDirecaoDoValor is false", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      colunas: validColunas,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("direcao");
  });

  it("requires direcao mapped when colunaDirecaoDetectada is true", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      colunaDirecaoDetectada: true,
      inferirDirecaoDoValor: true,
      colunas: validColunas,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("direcao");
  });

  it("accepts direcao mapped when colunaDirecaoDetectada is true", () => {
    expect(
      validateExtratoColumnMap({
        paginaReferencia: 1,
        colunaDirecaoDetectada: true,
        colunas: [...validColunas, { campo: "direcao", colunaIndex: 5 }],
      }).ok,
    ).toBe(true);
  });
});

describe("validateExtratoColumnMapPerPdf", () => {
  it("accepts partial map with data, valor and inferirDirecaoDoValor", () => {
    const r = validateExtratoColumnMapPerPdf({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0 },
        { campo: "valor", colunaIndex: 1 },
        { campo: "remetente_destinatario", colunaIndex: 2 },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects missing data", () => {
    const r = validateExtratoColumnMapPerPdf({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [{ campo: "valor", colunaIndex: 1 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("data");
  });
});

describe("validateExtratoColumnMapsSession", () => {
  const pixMap = {
    paginaReferencia: 1 as const,
    inferirDirecaoDoValor: true,
    colunas: [
      { campo: "data", colunaIndex: 0 },
      { campo: "valor", colunaIndex: 1 },
      { campo: "remetente_destinatario", colunaIndex: 2 },
    ],
  };

  const completoMap = {
    paginaReferencia: 1 as const,
    inferirDirecaoDoValor: true,
    colunas: [
      { campo: "data", colunaIndex: 0 },
      { campo: "valor", colunaIndex: 1 },
      { campo: "documento", colunaIndex: 2 },
      { campo: "historico", colunaIndex: 3 },
    ],
  };

  it("accepts union across PIX and completo", () => {
    expect(validateExtratoColumnMapsSession([pixMap, completoMap]).ok).toBe(true);
  });

  it("rejects when historico missing from all maps", () => {
    const r = validateExtratoColumnMapsSession([
      pixMap,
      {
        ...completoMap,
        colunas: completoMap.colunas.filter((c) => c.campo !== "historico"),
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("historico");
  });
});

describe("buildExtratoColumnPromptHint", () => {
  it("includes custom field labels", () => {
    const hint = buildExtratoColumnPromptHint({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0, headerLabel: "Data" },
        { campo: "custom_nro", colunaIndex: 4, label: "Nº doc." },
      ],
    });
    expect(hint).toContain("coluna 0 = data");
    expect(hint).toContain("Nº doc.");
    expect(hint).toContain("inferir");
  });

  it("clarifies documento vs cpf_cnpj for extraction", () => {
    const hint = buildExtratoColumnPromptHint({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "documento", colunaIndex: 2, headerLabel: "Documento" },
        { campo: "cpf_cnpj", colunaIndex: 5, headerLabel: "CPF/CNPJ" },
      ],
    });
    expect(hint).toContain("não CPF/CNPJ");
    expect(hint).toContain("cpf_cnpj");
  });
});

describe("parseExtratoColumnMap", () => {
  it("parses valid JSON", () => {
    const m = parseExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: validColunas,
    });
    expect(m?.colunas).toHaveLength(5);
  });

  it("parses partial per-PDF map without session fields", () => {
    const m = parseExtratoColumnMap({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0 },
        { campo: "valor", colunaIndex: 1 },
        { campo: "remetente_destinatario", colunaIndex: 2 },
      ],
    });
    expect(m?.colunas).toHaveLength(3);
  });

  it("parses colunaDirecaoDetectada", () => {
    const m = parseExtratoColumnMap({
      paginaReferencia: 1,
      colunaDirecaoDetectada: true,
      colunas: [...validColunas, { campo: "direcao", colunaIndex: 5 }],
    });
    expect(m?.colunaDirecaoDetectada).toBe(true);
  });

  it("returns null for invalid", () => {
    expect(parseExtratoColumnMap(null)).toBeNull();
    expect(parseExtratoColumnMap({ paginaReferencia: 2 })).toBeNull();
  });

  it("rejects legacy campo nome", () => {
    expect(
      parseExtratoColumnMap({
        paginaReferencia: 1,
        inferirDirecaoDoValor: true,
        colunas: [
          { campo: "data", colunaIndex: 0 },
          { campo: "valor", colunaIndex: 1 },
          { campo: "nome", colunaIndex: 2 },
        ],
      }),
    ).toBeNull();
  });
});

describe("validateExtratoColumnMapsSession remetente_destinatario", () => {
  it("rejects when remetente_destinatario missing from all maps", () => {
    const r = validateExtratoColumnMapsSession([
      {
        paginaReferencia: 1,
        inferirDirecaoDoValor: true,
        colunas: [
          { campo: "data", colunaIndex: 0 },
          { campo: "valor", colunaIndex: 1 },
          { campo: "documento", colunaIndex: 2 },
          { campo: "historico", colunaIndex: 3 },
        ],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("remetente_destinatario");
  });
});
