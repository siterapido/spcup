import type { MesFilter } from "./types";

export class ParseMesFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseMesFilterError";
  }
}

const MES_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Validates `YYYY-MM` and returns exercício year plus inclusive date bounds. */
export function parseMesFilter(mes: string): MesFilter {
  const trimmed = mes.trim();
  const match = MES_PATTERN.exec(trimmed);
  if (!match) {
    throw new ParseMesFilterError("mes deve estar no formato YYYY-MM");
  }

  const exercicio = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const lastDay = lastDayOfMonth(exercicio, month);
  const monthPadded = String(month).padStart(2, "0");

  return {
    exercicio,
    from: `${exercicio}-${monthPadded}-01`,
    to: `${exercicio}-${monthPadded}-${String(lastDay).padStart(2, "0")}`,
  };
}
