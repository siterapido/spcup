import { describe, expect, it } from "vitest";

import { explicarDiferencaDataPixCompleto } from "./explicar-diferenca-data";

describe("explicarDiferencaDataPixCompleto", () => {
  it("mesmo dia → ok sem motivo", () => {
    const r = explicarDiferencaDataPixCompleto("2025-01-10", "2025-01-10");
    expect(r.mesmoDia).toBe(true);
    expect(r.motivo).toBeNull();
    expect(r.status).toBe("ok");
  });

  it("PIX sábado → completo segunda", () => {
    const r = explicarDiferencaDataPixCompleto("2025-01-11", "2025-01-13");
    expect(r.diffDias).toBe(2);
    expect(r.motivo).toContain("sábado");
    expect(r.status).toBe("info");
  });

  it("PIX domingo → completo segunda", () => {
    const r = explicarDiferencaDataPixCompleto("2025-01-12", "2025-01-13");
    expect(r.diffDias).toBe(1);
    expect(r.motivo).toContain("domingo");
  });

  it("PIX em feriado fixo", () => {
    const r = explicarDiferencaDataPixCompleto("2025-01-01", "2025-01-02");
    expect(r.motivo).toContain("Ano Novo");
  });

  it("completo antes do PIX → warn", () => {
    const r = explicarDiferencaDataPixCompleto("2025-01-10", "2025-01-09");
    expect(r.status).toBe("warn");
  });
});
