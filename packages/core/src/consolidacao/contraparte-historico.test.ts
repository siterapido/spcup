import { describe, expect, it } from "vitest";
import { contraparteDoHistorico } from "./contraparte-historico";

describe("contraparteDoHistorico", () => {
  it("matches PIX RECEBIDO - MARIA SILVA", () => {
    expect(contraparteDoHistorico("PIX RECEBIDO - MARIA SILVA")).toBe("MARIA SILVA");
  });

  it("matches TED ENVIADA - JOAO SOUZA", () => {
    expect(contraparteDoHistorico("TED ENVIADA - JOAO SOUZA")).toBe("JOAO SOUZA");
  });

  it("matches case-insensitively and handles spacing", () => {
    expect(contraparteDoHistorico("pix enviado-maria silva")).toBe("MARIA SILVA");
  });

  it("returns null for non-names / unknown prefixes", () => {
    expect(contraparteDoHistorico("TARIFA PACOTE")).toBeNull();
    expect(contraparteDoHistorico("TARIFA - PACOTE")).toBeNull();
  });
});
