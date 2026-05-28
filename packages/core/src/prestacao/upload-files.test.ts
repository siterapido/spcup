import { describe, expect, it, vi } from "vitest";

const ingestFileBufferMock = vi.fn();
const armazenarPdfMock = vi.fn();

vi.mock("../ingest/pipeline", () => ({
  ingestFileBuffer: (...args: unknown[]) => ingestFileBufferMock(...args),
}));

vi.mock("../ingest/pdf-pagina", () => ({
  armazenarPdfIngestBuffer: (...args: unknown[]) => armazenarPdfMock(...args),
}));

import { uploadFilesToSessao } from "./upload-files";

describe("uploadFilesToSessao", () => {
  it("stores PDF in armazenar mode and ingests OFX immediately", async () => {
    ingestFileBufferMock.mockResolvedValue({ movimentacoes_criadas: 3, ids: [] });
    armazenarPdfMock.mockResolvedValue({
      arquivoId: "pdf-id",
      pageCount: 2,
      nome: "extrato.pdf",
    });

    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    } as never;
    const persistStorage = vi.fn(async (_p: string, _b: Buffer) => "/storage/x");

    const result = await uploadFilesToSessao(db, {
      sessaoId: "sess-1",
      diretorioEstadualId: "dir-1",
      uf: "BA",
      exercicio: 2025,
      prestador: {
        cnpjPrestador: "23738595000182",
        tipoPrestador: "ESTADUAL",
        sessaoPrestacaoId: "sess-1",
      },
      files: [
        { filename: "lanc.ofx", buffer: Buffer.from("ofx") },
        { filename: "extrato.pdf", buffer: Buffer.from("%PDF") },
      ],
      persistStorage,
    });

    expect(armazenarPdfMock).toHaveBeenCalledOnce();
    expect(ingestFileBufferMock).toHaveBeenCalledOnce();
    expect(result.arquivos).toHaveLength(2);
    expect(result.arquivos[1]?.modo).toBe("armazenar");
    expect(result.total_movimentacoes).toBe(3);
  });
});
