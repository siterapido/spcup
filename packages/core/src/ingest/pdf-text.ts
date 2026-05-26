import pdfParse from "pdf-parse";

export const MIN_TEXT_CHARS = 200;
export const MAX_EXTRATO_PAGES = 3;

export interface PdfTextExtraction {
  text: string;
  numpages: number;
  hasEnoughText: boolean;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfTextExtraction> {
  const parsed = await pdfParse(buffer);
  const numpages = parsed.numpages ?? 0;
  if (numpages > MAX_EXTRATO_PAGES) {
    throw new Error(
      `Extrato com mais de ${MAX_EXTRATO_PAGES} páginas; divida o arquivo ou use a CLI.`,
    );
  }
  const text = (parsed.text ?? "").trim();
  return {
    text,
    numpages,
    hasEnoughText: text.length >= MIN_TEXT_CHARS,
  };
}
