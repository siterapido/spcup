import { storeIngestBuffer } from "@spc-up/core";
import { put } from "@vercel/blob";

/**
 * Production: Vercel Blob when BLOB_READ_WRITE_TOKEN is set.
 * Local dev: filesystem under STORAGE_ROOT (same layout as Blob paths).
 */
export async function persistUpload(
  relativePath: string,
  buffer: Buffer,
): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token) {
    const blob = await put(relativePath, buffer, {
      access: "public",
      token,
    });
    return blob.url;
  }
  return storeIngestBuffer(relativePath, buffer);
}
