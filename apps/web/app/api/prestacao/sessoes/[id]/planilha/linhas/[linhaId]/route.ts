import { updatePlanilhaLinhaPessoa } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  fonte: z.enum(["consolidacao", "movimentacao"]),
  pessoaFisicaId: z.string().uuid().optional(),
  pessoaJuridicaId: z.string().uuid().optional(),
  limparPessoa: z.literal(true).optional(),
});

type RouteContext = { params: Promise<{ id: string; linhaId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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
  try {
    const { fonte, ...pessoa } = body;
    await updatePlanilhaLinhaPessoa(db, linhaId, fonte, pessoa);
    revalidatePath(`/prestacao/${id}/planilha`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao atualizar linha" },
      { status: 400 },
    );
  }
}
