import { describe, expect, it } from "vitest";

import {
  countPdfFiles,
  shouldBlockRedirect,
  shouldRedirectToConsolidacao,
} from "./use-prestacao-submit";

describe("shouldBlockRedirect", () => {
  it("blocks on 422", () => {
    expect(shouldBlockRedirect(422, 0, 1)).toBe(true);
  });

  it("blocks when zero movements and errors", () => {
    expect(shouldBlockRedirect(200, 0, 2)).toBe(true);
  });

  it("allows partial success", () => {
    expect(shouldBlockRedirect(200, 3, 1)).toBe(false);
  });

  it("allows full success", () => {
    expect(shouldBlockRedirect(200, 5, 0)).toBe(false);
  });
});

describe("shouldRedirectToConsolidacao", () => {
  it("redirects when flag and 2+ pdfs", () => {
    expect(shouldRedirectToConsolidacao(true, 2)).toBe(true);
  });

  it("skips when only one pdf", () => {
    expect(shouldRedirectToConsolidacao(true, 1)).toBe(false);
  });
});

describe("countPdfFiles", () => {
  it("counts pdf extensions", () => {
    const files = [
      new File(["a"], "a.pdf"),
      new File(["b"], "b.xlsx"),
      new File(["c"], "c.PDF"),
    ];
    expect(countPdfFiles(files)).toBe(2);
  });
});
