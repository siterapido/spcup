import type { Db } from "@spc-up/db";

import { rematchPendingMovimentacoes } from "./rematch";
import type { CadastroRow, ImportCadastroResult } from "./types";
import { upsertPessoa } from "./upsert";

export async function importCadastroBatch(
  db: Db,
  rows: CadastroRow[],
  uf: string,
  exercicio: number,
): Promise<ImportCadastroResult> {
  const result: ImportCadastroResult = {
    inseridos: 0,
    atualizados: 0,
    ignorados: 0,
    conflitos: 0,
    erros: [],
  };

  for (const row of rows) {
    try {
      const upsert = await upsertPessoa(db, row, {
        uf,
        exercicio,
        origem: "IMPORT",
      });
      switch (upsert.action) {
        case "inserted":
          result.inseridos += 1;
          break;
        case "updated":
          result.atualizados += 1;
          break;
        case "unchanged":
          result.ignorados += 1;
          break;
        case "conflict":
          result.conflitos += 1;
          break;
        default:
          break;
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      result.erros.push({ linha: row.linha, motivo });
    }
  }

  if (result.inseridos + result.atualizados > 0) {
    await rematchPendingMovimentacoes(db, uf, exercicio);
  }

  return result;
}
