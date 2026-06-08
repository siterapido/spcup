import { describe, expect, it } from "vitest";

import { buildExtratoTextPayload } from "./schemas";

describe("buildExtratoTextPayload column hint", () => {
  it("appends operator column map to user message", () => {
    const payload = buildExtratoTextPayload("linha1", "google/gemini-2.5-flash", {
      extratoColumnMap: {
        paginaReferencia: 1,
        inferirDirecaoDoValor: true,
        colunas: [
          { campo: "data", colunaIndex: 0 },
          { campo: "valor", colunaIndex: 1 },
          { campo: "documento", colunaIndex: 2 },
        ],
      },
    });
    const messages = (payload as { messages: { role: string; content: string }[] }).messages;
    const user = messages.find((m) => m.role === "user");
    expect(user?.content).toContain("coluna 0 = data");
  });
});
