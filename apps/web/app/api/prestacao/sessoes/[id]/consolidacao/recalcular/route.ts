import { recalcularConsolidacao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();

  let manterAprovados = false;
  try {
    const body = (await request.json()) as { manterAprovados?: boolean };
    manterAprovados = body.manterAprovados === true;
  } catch {
    /* default: recria tudo */
  }

  try {
    const result = await recalcularConsolidacao(db, id, { manterAprovados });
    revalidatePath(`/prestacao/${id}/consolidacao`);
    revalidatePath(`/prestacao/${id}/planilha`);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao recalcular consolidação" },
      { status: 500 },
    );
  }
}
