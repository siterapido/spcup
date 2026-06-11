import { describe, expect, it } from "vitest";

import { formatPeriodoPrestacao } from "./periodo";

describe("formatPeriodoPrestacao", () => {
  it("formata intervalo de datas", () => {
    expect(
      formatPeriodoPrestacao({
        dataInicio: "2025-01-02",
        dataFim: "2025-01-31",
      }),
    ).toBe("02/01/2025 a 31/01/2025");
  });

  it("formata dia único sem repetir", () => {
    expect(
      formatPeriodoPrestacao({
        dataInicio: "2025-03-15",
        dataFim: "2025-03-15",
      }),
    ).toBe("15/03/2025");
  });
});
