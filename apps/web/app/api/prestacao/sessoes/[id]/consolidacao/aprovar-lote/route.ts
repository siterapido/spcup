import { approveConsolidacaoEvento, listConsolidacaoForSessao } from "@spc-up/core";
import { CONSOLIDACAO_EVENTO_STATUS, getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  minConfianca: z.number().min(0).max(1).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  let body: z.infer<typeof bodySchema> = {};
  try {
    body = bodySchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const minConfianca = body.minConfianca ?? 0.85;
  const db = getDb();
  const { eventos } = await listConsolidacaoForSessao(db, id);

  const eligible = eventos.filter(
    (e) =>
      e.status === CONSOLIDACAO_EVENTO_STATUS.PENDENTE &&
      e.confianca >= minConfianca &&
      (e.pessoaFisicaId != null || e.pessoaJuridicaId != null),
  );

  let aprovados = 0;
  const erros: string[] = [];
  for (const ev of eligible) {
    try {
      await approveConsolidacaoEvento(db, ev.id);
      aprovados += 1;
    } catch (err) {
      erros.push(err instanceof Error ? err.message : String(err));
    }
  }

  return NextResponse.json({ aprovados, erros, elegiveis: eligible.length });
}
