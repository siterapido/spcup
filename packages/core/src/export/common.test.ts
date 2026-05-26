import { describe, expect, it } from "vitest";

import { formatMoeda, makeOrigemRoot, sub, xmlToBuffer } from "./common";

describe("formatMoeda", () => {
  it("formats numeric values with two decimals", () => {
    expect(formatMoeda(500)).toBe("500.00");
    expect(formatMoeda("250.5")).toBe("250.50");
  });
});

describe("xmlbuilder document", () => {
  it("builds namespaced root with child elements", () => {
    const root = makeOrigemRoot();
    const corpo = sub(root, "CORPO");
    sub(corpo, "totalOrigem", 1);
    const xml = xmlToBuffer(root).toString("utf-8");
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("spcaImportacaoArquivo");
    expect(xml).toContain("CORPO");
  });
});
