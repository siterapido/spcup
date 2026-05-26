import { describe, expect, it } from "vitest";

import { resolveCnpjPrestador } from "./sessao";
import { TIPO_PRESTADOR } from "@spc-up/db";

describe("resolveCnpjPrestador", () => {
  it("returns estadual cnpj", () => {
    expect(
      resolveCnpjPrestador({
        tipoPrestador: TIPO_PRESTADOR.ESTADUAL,
        diretorioEstadual: { cnpjPrestador: "11111111000111" },
        diretorioMunicipal: null,
      }),
    ).toBe("11111111000111");
  });

  it("returns municipal cnpj", () => {
    expect(
      resolveCnpjPrestador({
        tipoPrestador: TIPO_PRESTADOR.MUNICIPAL,
        diretorioEstadual: { cnpjPrestador: "11111111000111" },
        diretorioMunicipal: { cnpjPrestador: "22222222000122" },
      }),
    ).toBe("22222222000122");
  });
});
