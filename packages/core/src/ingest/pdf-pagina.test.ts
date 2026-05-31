import { describe, expect, it, vi } from "vitest";

import { IngestError } from "./errors";
import { finalizeArquivoIfLastPage } from "./pdf-pagina";

function createMockDb({
  movCount = 0,
  paginaStatuses = [] as string[],
}: {
  movCount?: number;
  paginaStatuses?: string[];
}) {
  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue({}),
  });

  const db = {
    select: vi.fn((fields: any) => {
      if (fields && fields.n) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ n: movCount }]),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(paginaStatuses.map((status) => ({ status }))),
        }),
      };
    }),
    update: vi.fn().mockReturnValue({
      set: updateSet,
    }),
  };

  return { db, updateSet };
}

describe("finalizeArquivoIfLastPage", () => {
  it("does nothing if pagina < totalPaginas", async () => {
    const { db } = createMockDb({});
    await finalizeArquivoIfLastPage(db as any, "arq-1", 1, 2);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("concludes file when there are created movements", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 2,
      paginaStatuses: ["VERIFICAR", "VERIFICAR"],
    });

    await finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2);

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
  });

  it("concludes file when hasOk is true", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 0,
      paginaStatuses: ["OK", "VERIFICAR"],
    });

    await finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
  });

  it("concludes file when hasNaoTransacional is true", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 0,
      paginaStatuses: ["NAO_TRANSACIONAL", "VERIFICAR"],
    });

    await finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
  });

  it("concludes file when hasVerificar is true even with no accepted transactions", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 0,
      paginaStatuses: ["VERIFICAR", "VERIFICAR"],
    });

    await finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2);

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONCLUIDO" }),
    );
  });

  it("throws PDF_SEM_TEXTO_E_VISAO_FALHOU if all pages are ERRO", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 0,
      paginaStatuses: ["ERRO", "ERRO"],
    });

    await expect(finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2)).rejects.toThrow(
      IngestError,
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ERRO", erroMensagem: expect.any(String) }),
    );
  });

  it("throws PDF_SEM_TEXTO_E_VISAO_FALHOU if no pages are OK, NAO_TRANSACIONAL, or VERIFICAR", async () => {
    const { db, updateSet } = createMockDb({
      movCount: 0,
      paginaStatuses: ["ERRO", "ERRO"],
    });

    try {
      await finalizeArquivoIfLastPage(db as any, "arq-1", 2, 2);
      expect.fail("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).detail.codigo).toBe("PDF_SEM_TEXTO_E_VISAO_FALHOU");
    }

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ERRO" }),
    );
  });
});
