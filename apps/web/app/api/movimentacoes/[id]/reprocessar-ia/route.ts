import { getMovimentacaoDetalhe, reprocessarIaMovimentacao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();

  try {
    await reprocessarIaMovimentacao(db, id);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "OpenRouter indisponível",
      },
      { status: 503 },
    );
  }

  const detalhe = await getMovimentacaoDetalhe(db, id);
  if (!detalhe) {
    return NextResponse.json({ error: "Movimentação não encontrada" }, { status: 404 });
  }

  if (detalhe.iaIndisponivel) {
    return NextResponse.json(
      { error: "OpenRouter indisponível", item: detalhe },
      { status: 503 },
    );
  }

  return NextResponse.json({ item: detalhe });
}
