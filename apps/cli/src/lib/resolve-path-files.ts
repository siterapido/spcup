import { resolveIngestPaths } from "@spc-up/core";
import { readFile } from "node:fs/promises";
import path from "node:path";

export type PathFileBuffer = { filename: string; buffer: Buffer };

export async function resolvePathToFileBuffers(
  inputPath: string,
): Promise<PathFileBuffer[]> {
  const sources = await resolveIngestPaths(inputPath);
  return Promise.all(
    sources.map(async (source) => ({
      filename: path.basename(source),
      buffer: await readFile(source),
    })),
  );
}
