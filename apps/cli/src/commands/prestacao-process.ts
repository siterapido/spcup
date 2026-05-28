import { processSessaoPdfArquivos } from "@spc-up/core";
import { getDb } from "@spc-up/db";

import { kanbanUrl, printJson } from "../lib/format-output";

export async function runPrestacaoProcess(opts: {
  sessao: string;
  skipConsolidacao?: boolean;
  json?: boolean;
}): Promise<void> {
  const db = getDb();
  const result = await processSessaoPdfArquivos(db, opts.sessao, {
    skipConsolidacao: opts.skipConsolidacao,
  });

  if (opts.json) {
    printJson(result);
    return;
  }

  console.log(
    `Sessão: ${result.sessaoId}  UF=${result.uf}  exercício=${result.exercicio}  consolidarExtratos=${result.consolidarExtratos}`,
  );

  for (const aviso of result.avisos) {
    console.log(aviso);
  }

  for (const arq of result.arquivos) {
    const pageCount = arq.paginas.length;
    console.log(`\nPDF ${arq.nome}${pageCount > 0 ? ` (${pageCount} página(s))` : ""}`);
    for (const p of arq.paginas) {
      console.log(
        `  p.${p.pagina} ${p.statusPagina} — ${p.movimentacoes_criadas} movimentação(ões)`,
      );
    }
    if (arq.erro) {
      console.error(`  ERRO — ${arq.erro}`);
    }
  }

  if (result.consolidacao?.skipped === false) {
    console.log(
      `\nConsolidação: executada — ${result.consolidacao.eventos} evento(s) gerados (aprovar em /prestacao/${result.sessaoId}/consolidacao)`,
    );
  } else if (result.consolidacao?.skipped) {
    console.log(`\nConsolidação: ignorada (${result.consolidacao.reason})`);
  }

  console.log(`\nPróximo passo: ${kanbanUrl(result.sessaoId)}`);
}
