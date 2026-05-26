import pdfParse from "pdf-parse";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractPdfText, MAX_EXTRATO_PAGES, MIN_TEXT_CHARS } from "./pdf-text";

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

describe("extractPdfText", () => {
  const stubBuffer = Buffer.alloc(0);

  beforeEach(() => {
    vi.mocked(pdfParse).mockReset();
  });

  it("returns trimmed text, numpages, and hasEnoughText true when long enough", async () => {
    const longText = "x".repeat(MIN_TEXT_CHARS);
    vi.mocked(pdfParse).mockResolvedValue({
      text: `  \n${longText}  `,
      numpages: 2,
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractPdfText(stubBuffer);

    expect(result.text).toBe(longText);
    expect(result.numpages).toBe(2);
    expect(result.hasEnoughText).toBe(true);
    expect(vi.mocked(pdfParse)).toHaveBeenCalledWith(stubBuffer);
  });

  it("sets hasEnoughText false when trimmed text is short", async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: "  short  ",
      numpages: 1,
    } as Awaited<ReturnType<typeof pdfParse>>);

    const result = await extractPdfText(stubBuffer);

    expect(result.text).toBe("short");
    expect(result.hasEnoughText).toBe(false);
  });

  it("throws when numpages exceeds MAX_EXTRATO_PAGES", async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: "irrelevant",
      numpages: MAX_EXTRATO_PAGES + 1,
    } as Awaited<ReturnType<typeof pdfParse>>);

    await expect(extractPdfText(stubBuffer)).rejects.toThrow(/mais de 3 páginas/i);
  });
});
