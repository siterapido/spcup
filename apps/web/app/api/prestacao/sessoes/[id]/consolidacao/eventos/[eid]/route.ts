import { consolidacaoEvento, getDb } from "@spc-up/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string; eid: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { eid } = await context.params;
  const body = (await request.json()) as {
    pessoaFisicaId: string | null;
    pessoaJuridicaId: string | null;
    confianca?: number;
    justificativa?: string;
  };

  const db = getDb();
  await db
    .update(consolidacaoEvento)
    .set({
      pessoaFisicaId: body.pessoaFisicaId || null,
      pessoaJuridicaId: body.pessoaJuridicaId || null,
      confianca: body.confianca !== undefined ? body.confianca : undefined,
      justificativa: body.justificativa !== undefined ? body.justificativa : undefined,
    })
    .where(eq(consolidacaoEvento.id, eid));

  return NextResponse.json({ success: true });
}
