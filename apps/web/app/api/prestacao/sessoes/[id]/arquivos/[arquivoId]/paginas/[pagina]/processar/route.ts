import {
  classifyIngestError,
  getSessao,
  ingestLog,
  prestadorFromSessao,
  processarPaginaPdfExtrato,
} from "@spc-up/core";
import { arquivoIngestao, getDb } from "@spc-up/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id: sessaoId, arquivoId, pagina: paginaRaw } = await context.params;
  const pagina = Number.parseInt(paginaRaw, 10);
  if (!Number.isInteger(pagina) || pagina < 1) {
    return NextResponse.json({ error: "Página inválida" }, { status: 400 });
  }

  const db = getDb();
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadualId) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const arquivoRows = await db
    .select({ id: arquivoIngestao.id })
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.id, arquivoId),
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
      ),
    )
    .limit(1);

  if (!arquivoRows[0]) {
    return NextResponse.json({ error: "Arquivo não encontrado nesta sessão" }, { status: 404 });
  }

  const prestador = prestadorFromSessao(sessao);

  try {
    const result = await processarPaginaPdfExtrato(db, arquivoId, pagina, {
      cnpjPrestador: prestador.cnpjPrestador,
      tipoPrestador: prestador.tipoPrestador,
      sessaoPrestacaoId: sessaoId,
      diretorioMunicipalId: prestador.diretorioMunicipalId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const detail = classifyIngestError(error);
    ingestLog("error", {
      fase: "persist",
      sessaoId,
      arquivoId,
      codigoErro: detail.codigo,
      causa: detail.causaTecnica,
    });
    return NextResponse.json(
      {
        error: detail.mensagem,
        codigo: detail.codigo,
        causaTecnica: detail.causaTecnica,
        pagina,
      },
      { status: 422 },
    );
  }
}
