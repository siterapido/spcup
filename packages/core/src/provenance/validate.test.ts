import { describe, expect, it } from "vitest";

import { clampBbox, validateOrigemExtracao } from "./validate";

describe("clampBbox", () => {
  it("drops invalid box", () => {
    expect(clampBbox({ x: 1.5, y: 0, w: 0.2, h: 0.1 })).toBeUndefined();
  });

  it("keeps valid box", () => {
    expect(clampBbox({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.05,
    });
  });
});

describe("validateOrigemExtracao", () => {
  it("rejects pagina out of range", () => {
    expect(
      validateOrigemExtracao(
        {
          arquivoIngestaoId: "aid",
          nomeArquivo: "x.pdf",
          pagina: 99,
          indiceLinha: 1,
        },
        3,
      ),
    ).toBeNull();
  });

  it("accepts valid origem", () => {
    expect(
      validateOrigemExtracao(
        {
          arquivoIngestaoId: "aid",
          nomeArquivo: "x.pdf",
          pagina: 2,
          indiceLinha: 3,
          bbox: { x: 0, y: 0.1, w: 1, h: 0.05 },
        },
        3,
      ),
    ).toMatchObject({ versao: 1, pagina: 2, indiceLinha: 3 });
  });
});
