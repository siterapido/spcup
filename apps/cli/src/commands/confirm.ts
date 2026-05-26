import { confirmMovimentacoes } from "@spc-up/core";
import { getDb } from "@spc-up/db";

function parseUuidList(ids: string): string[] {
  const parsed = ids
    .split(",")
    .map((raw) => raw.trim())
    .filter(Boolean);
  if (parsed.length === 0) {
    throw new Error("Informe ao menos um UUID em --ids.");
  }
  return parsed;
}

export async function runConfirm(opts: { ids: string }): Promise<void> {
  const db = getDb();
  const idList = parseUuidList(opts.ids);
  const result = await confirmMovimentacoes(db, idList);

  for (const id of result.notFound) {
    console.error(`Não encontrada: ${id}`);
  }

  console.log(`Confirmadas: ${result.confirmed}/${result.total}`);
}
