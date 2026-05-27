import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { storageRoot } from "../export/common";

/**
 * Persist upload bytes under STORAGE_ROOT (local dev / CLI parity).
 * Returns absolute filesystem path stored in `caminho_storage`.
 */
export async function storeIngestBuffer(
  relativePath: string,
  buffer: Buffer,
): Promise<string> {
  const root = path.resolve(storageRoot());
  const normalized = path
    .normalize(relativePath)
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const dest = path.resolve(root, normalized);
  if (dest !== root && !dest.startsWith(`${root}${path.sep}`)) {
    throw new Error("Caminho de storage inválido");
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buffer);
  return dest;
}
