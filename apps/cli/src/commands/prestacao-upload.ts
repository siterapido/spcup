import { storeIngestBuffer, uploadFilesToSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";

import { printJson } from "../lib/format-output";
import { resolvePathToFileBuffers } from "../lib/resolve-path-files";
import { requireSessaoContext } from "../lib/sessao-context";

export async function runPrestacaoUpload(opts: {
  sessao: string;
  path: string;
  json?: boolean;
}): Promise<void> {
  const db = getDb();
  const { sessao, prestador } = await requireSessaoContext(db, opts.sessao);
  const files = await resolvePathToFileBuffers(opts.path);

  const result = await uploadFilesToSessao(db, {
    sessaoId: sessao.id,
    diretorioEstadualId: sessao.diretorioEstadualId,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    prestador: {
      cnpjPrestador: prestador.cnpjPrestador,
      tipoPrestador: prestador.tipoPrestador,
      sessaoPrestacaoId: sessao.id,
      diretorioMunicipalId: prestador.diretorioMunicipalId,
    },
    files,
    persistStorage: storeIngestBuffer,
  });

  if (result.total_movimentacoes === 0 && result.erros.length > 0) {
    process.exitCode = 1;
  }

  if (opts.json) {
    printJson(result);
    return;
  }

  for (const a of result.arquivos) {
    const pdfNote = a.paginas ? `, ${a.paginas} pág. PDF armazenado` : "";
    console.log(`${a.nome}: ${a.movimentacoes_criadas} mov(s)${pdfNote}`);
  }
  for (const e of result.erros) {
    console.error(`${e.nome}: ${e.mensagem}`);
  }
}
