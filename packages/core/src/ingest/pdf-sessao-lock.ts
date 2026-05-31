import { arquivoIngestao, type Db } from "@spc-up/db";
import { and, eq, ne } from "drizzle-orm";

import { IngestError } from "./errors";
import { ARQUIVO_INGESTAO_STATUS } from "./types";

/** Ensures at most one PDF extrato is PROCESSANDO per prestação session. */
export async function assertSinglePdfProcessingInSessao(
  db: Db,
  sessaoId: string,
  currentArquivoId: string,
): Promise<void> {
  const rows = await db
    .select({ id: arquivoIngestao.id, nomeArquivo: arquivoIngestao.nomeArquivo })
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
        eq(arquivoIngestao.status, ARQUIVO_INGESTAO_STATUS.PROCESSANDO),
        ne(arquivoIngestao.id, currentArquivoId),
      ),
    )
    .limit(1);

  const other = rows[0];
  if (other) {
    throw new IngestError({
      codigo: "PDF_FILA_OCUPADA",
      mensagem:
        "Outro extrato PDF está em processamento. Aguarde terminar antes de processar o próximo.",
      causaTecnica: `arquivo_em_processamento=${other.id} nome=${other.nomeArquivo}`,
    });
  }
}
