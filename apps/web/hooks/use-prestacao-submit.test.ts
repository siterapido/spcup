import { describe, expect, it } from "vitest";

import { shouldBlockRedirect } from "./use-prestacao-submit";

describe("shouldBlockRedirect", () => {
  it("blocks on 422", () => {
    expect(shouldBlockRedirect(422, 0, 1)).toBe(true);
  });

  it("blocks when zero movements and errors", () => {
    expect(shouldBlockRedirect(200, 0, 2)).toBe(true);
  });

  it("allows partial success", () => {
    expect(shouldBlockRedirect(200, 3, 1)).toBe(false);
  });

  it("allows full success", () => {
    expect(shouldBlockRedirect(200, 5, 0)).toBe(false);
  });
});
