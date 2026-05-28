import { getPrestacaoCliStatus } from "@spc-up/core";
import { getDb } from "@spc-up/db";

import { kanbanUrl, printJson } from "../lib/format-output";

export async function runPrestacaoStatus(opts: {
  sessao: string;
  json?: boolean;
}): Promise<void> {
  const db = getDb();
  const status = await getPrestacaoCliStatus(db, opts.sessao);

  if (opts.json) {
    printJson(status);
    return;
  }

  console.log(
    `Sessão: ${status.sessaoId}  UF=${status.uf}  exercício=${status.exercicio}  status=${status.status}`,
  );
  console.log(`Consolidar extratos: ${status.consolidarExtratos}`);
  console.log(
    `Arquivos: ${status.arquivos.length} (${status.pdfPendentes} PDF pendente(s))`,
  );
  console.log(
    `Movimentações: ${status.movimentacoesTotal} total, ${status.movimentacoesPendentes} pendente(s)`,
  );
  console.log(`Consolidação: ${status.consolidacaoEventos} evento(s)`);
  console.log(`Kanban: ${kanbanUrl(status.sessaoId)}`);
}
