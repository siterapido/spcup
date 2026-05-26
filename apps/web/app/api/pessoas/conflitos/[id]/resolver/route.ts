import { resolveCadastroConflito, type ConflitoResolucao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

const VALID: ConflitoResolucao[] = ["MANTER_NOME", "ATUALIZAR_NOME", "IGNORADO"];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const body = (await request.json()) as { resolucao?: string };
  const resolucao = body.resolucao as ConflitoResolucao | undefined;

  if (!resolucao || !VALID.includes(resolucao)) {
    return NextResponse.json(
      { error: "resolucao inválida (MANTER_NOME, ATUALIZAR_NOME, IGNORADO)" },
      { status: 400 },
    );
  }

  try {
    const db = getDb();
    const updated = await resolveCadastroConflito(db, id, resolucao);
    return NextResponse.json({ ok: true, conflito: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao resolver";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
