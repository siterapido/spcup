import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  dedupeExtratoTransactions,
  getPdfPageCount,
  splitPdfIntoBatches,
} from "./pdf-split";

describe("dedupeExtratoTransactions", () => {
  it("removes duplicate rows", () => {
    const items = [
      {
        data: "2025-01-01",
        valor: 10,
        direcao: "ENTRADA",
        descricao: "PIX",
        nome: "Maria",
      },
      {
        data: "2025-01-01",
        valor: 10,
        direcao: "ENTRADA",
        descricao: "PIX",
        nome: "Maria",
      },
      {
        data: "2025-01-02",
        valor: 20,
        direcao: "SAIDA",
        descricao: "TED",
      },
    ];

    expect(dedupeExtratoTransactions(items)).toHaveLength(2);
  });
});

describe("splitPdfIntoBatches", () => {
  it("splits a 2-page PDF into two single-page buffers", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const full = Buffer.from(await doc.save());

    expect(await getPdfPageCount(full)).toBe(2);

    const batches = await splitPdfIntoBatches(full, 1);
    expect(batches).toHaveLength(2);
    expect(await getPdfPageCount(batches[0]!)).toBe(1);
    expect(await getPdfPageCount(batches[1]!)).toBe(1);
  });
});
