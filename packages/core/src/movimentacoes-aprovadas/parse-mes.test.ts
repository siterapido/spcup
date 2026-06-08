import { describe, expect, it } from "vitest";

import { ParseMesFilterError, parseMesFilter } from "./parse-mes";

describe("parseMesFilter", () => {
  it("parses January", () => {
    expect(parseMesFilter("2025-01")).toEqual({
      exercicio: 2025,
      from: "2025-01-01",
      to: "2025-01-31",
    });
  });

  it("handles leap year February", () => {
    expect(parseMesFilter("2024-02")).toEqual({
      exercicio: 2024,
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });

  it("handles non-leap February", () => {
    expect(parseMesFilter("2025-02")).toEqual({
      exercicio: 2025,
      from: "2025-02-01",
      to: "2025-02-28",
    });
  });

  it("handles December", () => {
    expect(parseMesFilter("2025-12")).toEqual({
      exercicio: 2025,
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("trims input", () => {
    expect(parseMesFilter(" 2025-06 ")).toEqual({
      exercicio: 2025,
      from: "2025-06-01",
      to: "2025-06-30",
    });
  });

  it("rejects invalid format", () => {
    expect(() => parseMesFilter("2025/01")).toThrow(ParseMesFilterError);
    expect(() => parseMesFilter("25-01")).toThrow(ParseMesFilterError);
    expect(() => parseMesFilter("2025-1")).toThrow(ParseMesFilterError);
  });

  it("rejects month 00 and 13", () => {
    expect(() => parseMesFilter("2025-00")).toThrow(ParseMesFilterError);
    expect(() => parseMesFilter("2025-13")).toThrow(ParseMesFilterError);
  });
});
