import { getPessoa, updatePessoa } from "@spc-up/core";
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

export async function PATCH(
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

  let body: { nome?: string; tituloEleitor?: string | null; aliases?: string[] | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const db = getDb();
  const result = await updatePessoa(db, id, tipo, body);

  if (result === "not_found") {
    return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
  }
  if (result === "invalid") {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar" }, { status: 400 });
  }

  const pessoa = await getPessoa(db, id, tipo);
  if (!pessoa) {
    return NextResponse.json({ error: "Pessoa não encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    ...pessoa,
    documento_mascarado: maskDocumento(pessoa.tipo, pessoa.documento),
    unchanged: result === "unchanged",
  });
}
