import { planilhaLinhaBelongsToSessao, resolvePlanilhaMerge } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  acao: z.enum(["confirmar", "separar"]),
  fonte: z.enum(["consolidacao", "movimentacao"]).optional(),
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

  if (body.fonte === "movimentacao") {
    return NextResponse.json(
      { error: "Merge válido apenas para linhas de consolidação" },
      { status: 400 },
    );
  }

  const db = getDb();
  const fonte = body.fonte ?? "consolidacao";
  const belongs = await planilhaLinhaBelongsToSessao(db, id, linhaId, fonte);
  if (!belongs) {
    return NextResponse.json({ error: "Evento não encontrado" }, { status: 404 });
  }

  try {
    await resolvePlanilhaMerge(db, linhaId, body.acao);
    revalidatePath(`/prestacao/${id}/planilha`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao resolver merge" },
      { status: 400 },
    );
  }
}
