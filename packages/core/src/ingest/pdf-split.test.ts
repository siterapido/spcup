import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  dedupeExtratoTransactions,
  extractSinglePageBuffer,
  getPdfPageCount,
  shouldBatchPdfVision,
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

describe("shouldBatchPdfVision", () => {
  const smallBuf = Buffer.alloc(50_000);
  const largeBuf = Buffer.alloc(250_000);

  it("gemini: does not batch 2 pages under byte threshold", () => {
    expect(shouldBatchPdfVision(smallBuf, 2, "google/gemini-3.5-flash")).toBe(false);
  });

  it("gemini: does not batch 2 pages even when over byte threshold", () => {
    expect(shouldBatchPdfVision(largeBuf, 2, "google/gemini-3.5-flash")).toBe(false);
  });

  it("gemini: batches single page over byte threshold", () => {
    expect(shouldBatchPdfVision(largeBuf, 1, "google/gemini-3.5-flash")).toBe(true);
  });

  it("kimi: batches 2 pages even when small", () => {
    expect(shouldBatchPdfVision(smallBuf, 2, "moonshotai/kimi-k2.6")).toBe(true);
  });

  it("kimi: batches single page >= 80KB", () => {
    const buf = Buffer.alloc(90_000);
    expect(shouldBatchPdfVision(buf, 1, "moonshotai/kimi-k2.6")).toBe(true);
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

  it("extractSinglePageBuffer returns one page by 1-based index", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const full = Buffer.from(await doc.save());

    const page2 = await extractSinglePageBuffer(full, 2);
    expect(await getPdfPageCount(page2)).toBe(1);
  });
});
