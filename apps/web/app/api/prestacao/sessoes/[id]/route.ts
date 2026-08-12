import { getSessao, persistArquivoBaseIngestaoId } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();

  let body: { arquivoBaseIngestaoId?: string | null };
  try {
    body = (await request.json()) as { arquivoBaseIngestaoId?: string | null };
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  if (!("arquivoBaseIngestaoId" in body)) {
    return NextResponse.json(
      { error: "Campo arquivoBaseIngestaoId obrigatório" },
      { status: 400 },
    );
  }

  const sessao = await getSessao(db, id);
  if (!sessao) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const raw = body.arquivoBaseIngestaoId;
  const nextBase: string | null =
    raw === null || raw === undefined || raw === "" ? null : raw;

  await persistArquivoBaseIngestaoId(db, id, nextBase);

  return NextResponse.json({ ok: true, arquivoBaseIngestaoId: nextBase });
}
