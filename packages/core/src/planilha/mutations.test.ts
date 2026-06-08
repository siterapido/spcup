import { describe, expect, it, vi } from "vitest";

import { resolvePlanilhaMerge } from "./mutations";

describe("resolvePlanilhaMerge", () => {
  it("confirmar delega approveConsolidacaoEvento", async () => {
    const approve = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "confirmar", {
      approveConsolidacaoEvento: approve,
    });
    expect(approve).toHaveBeenCalledWith(db, "ev-1");
  });

  it("separar delega rejectConsolidacaoEvento", async () => {
    const reject = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "separar", {
      rejectConsolidacaoEvento: reject,
    });
    expect(reject).toHaveBeenCalledWith(db, "ev-1");
  });
});
