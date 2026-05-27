import { describe, expect, it } from "vitest";

import { origemFromExtratoItem } from "./attach-extracao";

describe("origemFromExtratoItem", () => {
  it("uses batch page when model returns different page", () => {
    const o = origemFromExtratoItem(
      { pagina: 9, indice_linha: 2, bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.05 } },
      {
        arquivoIngestaoId: "aid",
        nomeArquivo: "extrato.pdf",
        batchPagina: 2,
        pageCount: 3,
      },
    );
    expect(o?.pagina).toBe(2);
    expect(o?.indiceLinha).toBe(2);
    expect(o?.bbox).toEqual({ x: 0.1, y: 0.2, w: 0.8, h: 0.05 });
  });
});
