import { confirmMovimentacoes } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()),
});

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = getDb();
  const result = await confirmMovimentacoes(db, body.ids);
  const erros = result.notFound.map((id) => `Não encontrada: ${id}`);

  const errosBlocked = result.blocked.map(
    (id) => `Bloqueada para exportação: ${id}`,
  );

  return NextResponse.json({
    confirmadas: result.confirmed,
    blocked: result.blocked,
    erros: [...erros, ...errosBlocked],
  });
}
