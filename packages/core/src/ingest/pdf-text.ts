import "./pdf-node-setup";
import pdfParse from "pdf-parse";

import { assertExtratoPageLimit } from "./pdf-split";

export const MIN_TEXT_CHARS = 200;
export { MAX_EXTRATO_PAGES } from "./pdf-split";

export interface PdfTextExtraction {
  text: string;
  numpages: number;
  hasEnoughText: boolean;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfTextExtraction> {
  const parsed = await pdfParse(buffer);
  const numpages = parsed.numpages ?? 0;
  assertExtratoPageLimit(numpages);
  const text = (parsed.text ?? "").trim();
  return {
    text,
    numpages,
    hasEnoughText: text.length >= MIN_TEXT_CHARS,
  };
}
