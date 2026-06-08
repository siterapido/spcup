import { confirmarExtracaoPlanilhaLinha, planilhaLinhaBelongsToSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  fonte: z.enum(["consolidacao", "movimentacao"]),
});

type RouteContext = { params: Promise<{ id: string; linhaId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id, linhaId } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = getDb();
  const belongs = await planilhaLinhaBelongsToSessao(db, id, linhaId, body.fonte);
  if (!belongs) {
    return NextResponse.json({ error: "Linha não encontrada" }, { status: 404 });
  }

  try {
    await confirmarExtracaoPlanilhaLinha(db, linhaId, body.fonte);
    revalidatePath(`/prestacao/${id}/planilha`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao confirmar extração" },
      { status: 400 },
    );
  }
}
