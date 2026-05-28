import {
  classifyIngestError,
  getSessao,
  ignorarPaginaPdfExtrato,
  ingestLog,
  loadPaginaPdfComoPng,
  prestadorFromSessao,
  processarPaginaPdfExtrato,
  type ProcessarPaginaPdfModo,
} from "@spc-up/core";
import { arquivoIngestao, getDb } from "@spc-up/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export const paginaPdfRuntime = "nodejs";
export const paginaPdfMaxDuration = 300;

type PaginaParams = { id: string; arquivoId: string; pagina: string };

async function resolvePaginaContext(params: PaginaParams) {
  const authResult = await requireSession();
  if ("error" in authResult) {
    return { error: authResult.error } as const;
  }

  const pagina = Number.parseInt(params.pagina, 10);
  if (!Number.isInteger(pagina) || pagina < 1) {
    return {
      error: NextResponse.json({ error: "Página inválida" }, { status: 400 }),
    } as const;
  }

  const db = getDb();
  const sessao = await getSessao(db, params.id);
  if (!sessao?.diretorioEstadualId) {
    return {
      error: NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 }),
    } as const;
  }

  const arquivoRows = await db
    .select({ id: arquivoIngestao.id })
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.id, params.arquivoId),
        eq(arquivoIngestao.sessaoPrestacaoId, params.id),
      ),
    )
    .limit(1);

  if (!arquivoRows[0]) {
    return {
      error: NextResponse.json({ error: "Arquivo não encontrado nesta sessão" }, { status: 404 }),
    } as const;
  }

  return {
    db,
    sessaoId: params.id,
    arquivoId: params.arquivoId,
    pagina,
    prestador: prestadorFromSessao(sessao),
  } as const;
}

async function parseForceFlag(request: Request): Promise<boolean> {
  try {
    const body = (await request.json()) as { force?: unknown };
    return body?.force === true;
  } catch {
    return false;
  }
}

export async function handleProcessarPaginaPdf(
  request: Request,
  params: PaginaParams,
  modo: ProcessarPaginaPdfModo = "auto",
) {
  const ctx = await resolvePaginaContext(params);
  if ("error" in ctx) return ctx.error;

  const force = await parseForceFlag(request);

  try {
    const result = await processarPaginaPdfExtrato(
      ctx.db,
      ctx.arquivoId,
      ctx.pagina,
      {
        cnpjPrestador: ctx.prestador.cnpjPrestador,
        tipoPrestador: ctx.prestador.tipoPrestador,
        sessaoPrestacaoId: ctx.sessaoId,
        diretorioMunicipalId: ctx.prestador.diretorioMunicipalId,
      },
      { force, modo },
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (modo === "texto" && message.includes("texto suficiente")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    const detail = classifyIngestError(error);
    ingestLog("error", {
      fase: "persist",
      sessaoId: ctx.sessaoId,
      arquivoId: ctx.arquivoId,
      codigoErro: detail.codigo,
      causa: detail.causaTecnica,
    });
    return NextResponse.json(
      {
        error: detail.mensagem,
        codigo: detail.codigo,
        causaTecnica: detail.causaTecnica,
        pagina: ctx.pagina,
      },
      { status: 422 },
    );
  }
}

export async function handlePaginaPdfImagem(params: PaginaParams) {
  const ctx = await resolvePaginaContext(params);
  if ("error" in ctx) return ctx.error;

  try {
    const png = await loadPaginaPdfComoPng(ctx.db, ctx.arquivoId, ctx.pagina);
    return new NextResponse(new Uint8Array(png), {
      headers: { "Content-Type": "image/png" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao renderizar página";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

export async function handleIgnorarPaginaPdf(params: PaginaParams) {
  const ctx = await resolvePaginaContext(params);
  if ("error" in ctx) return ctx.error;

  await ignorarPaginaPdfExtrato(ctx.db, ctx.arquivoId, ctx.pagina);
  return NextResponse.json({ ok: true, pagina: ctx.pagina });
}
