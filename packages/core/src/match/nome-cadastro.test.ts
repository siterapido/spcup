import { describe, expect, it } from "vitest";
import { compararNomeCadastro } from "./nome-cadastro";

describe("compararNomeCadastro", () => {
  it("bate em igualdade normalizada (acento/caixa)", () => {
    expect(compararNomeCadastro("João Silva", "JOAO SILVA")).toBe("bate");
  });
  it("bate quando um contém o outro", () => {
    expect(compararNomeCadastro("MARIA SILVA", "MARIA DA SILVA SOUZA")).toBe("bate");
  });
  it("difere quando nomes distintos", () => {
    expect(compararNomeCadastro("ANA LIMA", "CARLOS REIS")).toBe("difere");
  });
  it("indefinido quando extraido vazio/curto", () => {
    expect(compararNomeCadastro("", "MARIA")).toBe("indefinido");
    expect(compararNomeCadastro("PIX", "MARIA")).toBe("indefinido");
  });
  it("indefinido quando cadastro vazio", () => {
    expect(compararNomeCadastro("MARIA SILVA", "")).toBe("indefinido");
  });
});
