import { describe, expect, it, vi, beforeEach } from "vitest";

import type { OrigemExtracaoV1 } from "./types";
import {
  anexarBboxOrigensPorArquivo,
  precisaAncorarBbox,
} from "./anexar-bbox-origens";

vi.mock("../pdf-locate/extract-pdf-text-layer", () => ({
  extractPdfTextLayer: vi.fn(),
}));

vi.mock("../pdf-locate/localizar-linha-pdf", () => ({
  localizarLinhaPdf: vi.fn(),
}));

import { extractPdfTextLayer } from "../pdf-locate/extract-pdf-text-layer";
import { localizarLinhaPdf } from "../pdf-locate/localizar-linha-pdf";

const origemBase: OrigemExtracaoV1 = {
  versao: 1,
  arquivoIngestaoId: "arq-1",
  nomeArquivo: "pix.pdf",
  pagina: 1,
  indiceLinha: 2,
};

describe("precisaAncorarBbox", () => {
  it("ignora origem com bbox do modelo", () => {
    expect(
      precisaAncorarBbox({
        ...origemBase,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.04 },
        ancoragem: "modelo",
      }),
    ).toBe(false);
  });

  it("ancora quando não há bbox", () => {
    expect(precisaAncorarBbox(origemBase)).toBe(true);
  });

  it("não re-tenta nao_localizado sem force", () => {
    expect(
      precisaAncorarBbox({ ...origemBase, ancoragem: "nao_localizado" }),
    ).toBe(false);
  });

  it("re-tenta nao_localizado com force", () => {
    expect(
      precisaAncorarBbox(
        { ...origemBase, ancoragem: "nao_localizado" },
        { force: true },
      ),
    ).toBe(true);
  });
});

describe("anexarBboxOrigensPorArquivo", () => {
  let lastSetArg: Record<string, unknown> | undefined;
  const db = {
    select: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSetArg = undefined;
    db.update.mockImplementation(() => ({
      set: vi.fn((arg: Record<string, unknown>) => {
        lastSetArg = arg;
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    }));
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "mov-1",
            arquivoIngestaoId: "arq-1",
            dataMovimento: "2025-01-03",
            valor: "100.00",
            descricaoRaw: "PIX",
            origemExtracao: origemBase,
            camposExtracao: {
              remetente_destinatario: "NADSON SILVA DOS SANTOS",
            },
          },
        ]),
      }),
    });
  });

  it("persiste bbox e ancoragem text_layer quando localiza", async () => {
    vi.mocked(extractPdfTextLayer).mockResolvedValue({
      paginas: [{ pagina: 1, itens: [] }],
      pageCount: 1,
    });
    vi.mocked(localizarLinhaPdf).mockReturnValue({
      encontrado: true,
      pagina: 1,
      bbox: { x: 0.1, y: 0.6, w: 0.8, h: 0.04 },
      confianca: "estimada",
    });

    const result = await anexarBboxOrigensPorArquivo(
      db as never,
      "arq-1",
      Buffer.from("pdf"),
      { nomeArquivo: "Extrato Jan PIX (1).pdf" },
    );

    expect(result).toMatchObject({ ancoradas: 1, falhas: 0 });
    expect(lastSetArg?.origemExtracao).toMatchObject({
      ancoragem: "text_layer",
      bbox: { x: 0.1, y: 0.6, w: 0.8, h: 0.04 },
    });
  });

  it("marca nao_localizado quando localizar falha após retry", async () => {
    vi.mocked(extractPdfTextLayer).mockResolvedValue({
      paginas: [{ pagina: 1, itens: [] }],
      pageCount: 1,
    });
    vi.mocked(localizarLinhaPdf).mockReturnValue({
      encontrado: false,
      motivo: "Nenhuma linha com valor e data na mesma linha",
    });

    const result = await anexarBboxOrigensPorArquivo(
      db as never,
      "arq-1",
      Buffer.from("pdf"),
      { nomeArquivo: "extrato.pdf" },
    );

    expect(result).toMatchObject({ ancoradas: 0, falhas: 1 });
    expect(lastSetArg?.origemExtracao).toMatchObject({
      ancoragem: "nao_localizado",
    });
  });
});
