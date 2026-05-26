import { approveConsolidacaoEvento } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string; eid: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id, eid } = await context.params;
  const db = getDb();

  try {
    await approveConsolidacaoEvento(db, eid);
    revalidatePath(`/prestacao/${id}/consolidacao`);
    revalidatePath(`/prestacao/${id}/kanban`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao aprovar" },
      { status: 400 },
    );
  }
}
