import { rejectConsolidacaoEvento } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string; eid: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { eid } = await context.params;
  const db = getDb();

  try {
    await rejectConsolidacaoEvento(db, eid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao rejeitar" },
      { status: 400 },
    );
  }
}
