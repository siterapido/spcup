import { applyPlanilhaLote } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        fonte: z.enum(["consolidacao", "movimentacao"]),
      }),
    )
    .min(1),
  pessoaFisicaId: z.string().uuid().optional(),
  pessoaJuridicaId: z.string().uuid().optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = getDb();
  try {
    const { items, pessoaFisicaId, pessoaJuridicaId } = body;
    await applyPlanilhaLote(db, items, { pessoaFisicaId, pessoaJuridicaId });
    revalidatePath(`/prestacao/${id}/planilha`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao aplicar lote" },
      { status: 400 },
    );
  }
}
