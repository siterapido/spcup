import { runPrestacaoProcess } from "./prestacao-process";
import { runPrestacaoUpload } from "./prestacao-upload";

export async function runPrestacaoRun(opts: {
  sessao: string;
  path: string;
  skipConsolidacao?: boolean;
  json?: boolean;
}): Promise<void> {
  await runPrestacaoUpload({
    sessao: opts.sessao,
    path: opts.path,
    json: opts.json,
  });
  if (process.exitCode === 1) return;

  await runPrestacaoProcess({
    sessao: opts.sessao,
    skipConsolidacao: opts.skipConsolidacao,
    json: opts.json,
  });
}
