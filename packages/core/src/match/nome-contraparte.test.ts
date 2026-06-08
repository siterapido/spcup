import { describe, expect, it } from "vitest";
import {
  extractNomeContraparte,
  deriveNomeContraparte,
  isNomeContraparteVazio,
} from "./nome-contraparte";

describe("extractNomeContraparte", () => {
  it("remove prefixo bancário e documento", () => {
    expect(
      extractNomeContraparte("CRED PIX GABRIEL REIS DA SILVA CPF 12345678909"),
    ).toBe("GABRIEL REIS DA SILVA");
  });

  it("retorna vazio para só CRED PIX", () => {
    expect(extractNomeContraparte("CRED PIX")).toBe("");
  });

  it("extrai nome-only PIX", () => {
    expect(extractNomeContraparte("GABRIEL REIS DA SILVA")).toBe(
      "GABRIEL REIS DA SILVA",
    );
  });
});

describe("deriveNomeContraparte regra D", () => {
  it("prefere nome PIX quando completo tem doc", () => {
    expect(
      deriveNomeContraparte([
        { descricaoRaw: "GABRIEL REIS DA SILVA", papel: "PIX" },
        {
          descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
          papel: "COMPLETO",
        },
      ]),
    ).toBe("GABRIEL REIS DA SILVA");
  });

  it("usa completo quando PIX sem nome", () => {
    expect(
      deriveNomeContraparte([
        { descricaoRaw: "CRED PIX", papel: "PIX" },
        {
          descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
          papel: "COMPLETO",
        },
      ]),
    ).toBe("GABRIEL REIS DA SILVA");
  });
});

describe("isNomeContraparteVazio", () => {
  it("true para string curta ou vazia", () => {
    expect(isNomeContraparteVazio("")).toBe(true);
    expect(isNomeContraparteVazio("PI")).toBe(true);
  });
});
