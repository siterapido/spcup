import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ParsedTransactionRow } from "./types";

export function fileHashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function fileHash(path: string): Promise<string> {
  const buffer = await readFile(path);
  return fileHashBuffer(buffer);
}

export function computeHashMovimento(
  uf: string,
  exercicio: number,
  row: ParsedTransactionRow,
): string {
  const payload = [
    uf,
    String(exercicio),
    row.dataMovimento.toISOString().slice(0, 10),
    row.valor,
    row.descricaoRaw,
    row.direcao,
    row.nrExtratoBancario ?? "",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
