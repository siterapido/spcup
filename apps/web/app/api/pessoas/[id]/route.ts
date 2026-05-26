import { getPessoa } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";
import { maskDocumento } from "@/lib/mask-document";
import { parsePessoaTipoParam } from "@/lib/parse-pessoa-tipo";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const tipo = parsePessoaTipoParam(new URL(request.url).searchParams.get("tipo"));
  if (!tipo) {
    return NextResponse.json({ error: "Parâmetro tipo=pf|pj obrigatório" }, { status: 400 });
  }

  const db = getDb();
  const pessoa = await getPessoa(db, id, tipo);
  if (!pessoa) {
    return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    ...pessoa,
    documento_mascarado: maskDocumento(pessoa.tipo, pessoa.documento),
  });
}
