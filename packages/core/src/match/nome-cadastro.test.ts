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

  it.each([
    ["GABRIELLE DIAS PIMENTEL", "GABRIELLE D PIMENTEL"],
    ["MANOELA MATIAS HORA", "MANOELA M HORA"],
    ["VITOR HUGO MOREAU DA CUNHA", "VITOR HUGO M CUNHA"],
    ["JALICIA LIMA SANTOS MURICY", "JALICIA L S MURICY"],
    ["MATEUS BULHOES NUNES SOUTO", "MATEUS B N SOUTO"],
  ])("bate abreviação cadastro: %s vs %s", (extrato, cadastro) => {
    expect(compararNomeCadastro(extrato, cadastro)).toBe("bate");
  });
});
