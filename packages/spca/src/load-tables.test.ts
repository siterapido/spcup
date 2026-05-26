import { describe, expect, it } from "vitest";

import { getClassificacaoLabel, getGastoLabel } from "./load-tables.js";

describe("load-tables", () => {
  it("loads classificacao labels", () => {
    expect(getClassificacaoLabel("314")).toContain("314");
    expect(getClassificacaoLabel(314)).toContain("DOAÇÕES");
  });

  it("loads gasto labels", () => {
    expect(getGastoLabel("410")).toContain("410");
    expect(getGastoLabel(410)).toContain("CARTÕES");
  });

  it("returns code only for unknown entries", () => {
    expect(getClassificacaoLabel("999")).toBe("999");
    expect(getGastoLabel("999")).toBe("999");
  });
});
