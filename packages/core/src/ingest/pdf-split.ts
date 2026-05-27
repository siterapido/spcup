import { PDFDocument } from "pdf-lib";

import { resolveModelProfile } from "../ai/model-profile";

/** Max pages allowed per extrato file (batched vision processes each page). */
export const MAX_EXTRATO_PAGES = Number.parseInt(
  process.env.MAX_EXTRATO_PAGES ?? "12",
  10,
);

export function resolvePdfPagesPerBatch(): number {
  const raw = process.env.OPENROUTER_PDF_PAGES_PER_BATCH;
  if (raw == null || raw.trim() === "") {
    return 1;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function resolvePdfSplitMinBytes(): number {
  const raw = process.env.OPENROUTER_PDF_SPLIT_MIN_BYTES;
  if (raw == null || raw.trim() === "") {
    return 200_000;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 200_000;
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  } catch {
    return 1;
  }
}

export function assertExtratoPageLimit(pageCount: number): void {
  if (pageCount > MAX_EXTRATO_PAGES) {
    throw new Error(
      `Extrato com mais de ${MAX_EXTRATO_PAGES} páginas; divida o arquivo.`,
    );
  }
}

/** Split PDF into buffers of N pages each (default 1 page per batch). */
export async function splitPdfIntoBatches(
  buffer: Buffer,
  pagesPerBatch = resolvePdfPagesPerBatch(),
): Promise<Buffer[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  assertExtratoPageLimit(pageCount);

  if (pageCount <= pagesPerBatch) {
    return [buffer];
  }

  const batches: Buffer[] = [];
  for (let start = 0; start < pageCount; start += pagesPerBatch) {
    const end = Math.min(start + pagesPerBatch, pageCount);
    const indices = Array.from({ length: end - start }, (_, offset) => start + offset);
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, indices);
    for (const page of copied) {
      doc.addPage(page);
    }
    batches.push(Buffer.from(await doc.save()));
  }

  return batches;
}

export function shouldBatchPdfVision(
  buffer: Buffer,
  pageCount: number,
  model: string,
): boolean {
  const profile = resolveModelProfile(model);

  if (profile.pdfBatching === "gemini_native") {
    if (pageCount > 1 && pageCount <= MAX_EXTRATO_PAGES) {
      return false;
    }
    return buffer.length >= resolvePdfSplitMinBytes();
  }

  if (buffer.length >= resolvePdfSplitMinBytes()) {
    return true;
  }

  if (pageCount > 1) {
    return true;
  }
  return buffer.length >= 80_000;
}

export function dedupeExtratoTransactions(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];

  for (const item of items) {
    const key = [
      String(item.data ?? ""),
      String(item.valor ?? ""),
      String(item.direcao ?? "").toUpperCase(),
      String(item.descricao ?? "").trim(),
      String(item.cpf ?? ""),
      String(item.cnpj ?? ""),
      String(item.nome ?? "").trim(),
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }

  return out;
}
