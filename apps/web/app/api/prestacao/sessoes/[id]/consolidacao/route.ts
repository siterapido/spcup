import { getSessao, listConsolidacaoForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();

  const sessao = await getSessao(db, id);
  if (!sessao) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const payload = await listConsolidacaoForSessao(db, id);
  return NextResponse.json({
    sessaoId: id,
    consolidarExtratos: sessao.consolidarExtratos,
    ...payload,
  });
}
