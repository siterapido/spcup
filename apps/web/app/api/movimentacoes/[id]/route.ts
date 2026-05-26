import {
  assignPessoaToMovimentacao,
  getMovimentacaoDetalhe,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const patchSchema = z.union([
  z.object({ pessoaFisicaId: z.string().uuid() }),
  z.object({ pessoaJuridicaId: z.string().uuid() }),
  z.object({ limparPessoa: z.literal(true) }),
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();
  const detalhe = await getMovimentacaoDetalhe(db, id);
  if (!detalhe) {
    return NextResponse.json({ error: "Movimentação não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ item: detalhe });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = getDb();
  try {
    await assignPessoaToMovimentacao(db, id, body);
    const detalhe = await getMovimentacaoDetalhe(db, id);
    return NextResponse.json({ item: detalhe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao vincular pessoa" },
      { status: 400 },
    );
  }
}
