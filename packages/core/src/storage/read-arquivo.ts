import { readFile } from "node:fs/promises";

/** Load arquivo bytes from local path or HTTP(S) URL (Vercel Blob). */
export async function readArquivoIngestaoBuffer(caminhoStorage: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(caminhoStorage)) {
    const res = await fetch(caminhoStorage);
    if (!res.ok) {
      throw new Error(`Falha ao baixar arquivo: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(caminhoStorage);
}
