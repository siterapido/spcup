import { describe, expect, it, vi } from "vitest";

import { IngestError } from "./errors";
import { assertSinglePdfProcessingInSessao } from "./pdf-sessao-lock";

describe("assertSinglePdfProcessingInSessao", () => {
  it("allows processing when no other PDF is active", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      }),
    } as never;

    await expect(
      assertSinglePdfProcessingInSessao(db, "sess-1", "arq-a"),
    ).resolves.toBeUndefined();
  });

  it("rejects when another PDF is PROCESSANDO", async () => {
    const limit = vi.fn().mockResolvedValue([
      { id: "arq-b", nomeArquivo: "outro.pdf" },
    ]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      }),
    } as never;

    await expect(
      assertSinglePdfProcessingInSessao(db, "sess-1", "arq-a"),
    ).rejects.toMatchObject({
      detail: { codigo: "PDF_FILA_OCUPADA" },
    } satisfies { detail: { codigo: string } });
  });

  it("throws IngestError with PDF_FILA_OCUPADA", async () => {
    const limit = vi.fn().mockResolvedValue([{ id: "arq-b", nomeArquivo: "b.pdf" }]);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit }),
        }),
      }),
    } as never;

    try {
      await assertSinglePdfProcessingInSessao(db, "sess-1", "arq-a");
      expect.fail("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).detail.codigo).toBe("PDF_FILA_OCUPADA");
    }
  });
});
