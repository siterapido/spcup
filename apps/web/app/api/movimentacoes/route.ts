import {
  listMovimentacoesAprovadas,
  ParseMesFilterError,
  softDeleteMovimentacoes,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = new URL(request.url);
  const uf = searchParams.get("uf");
  const mes = searchParams.get("mes");
  const pageRaw = searchParams.get("page");
  const limitRaw = searchParams.get("limit");

  if (!uf?.trim() || !mes?.trim()) {
    return NextResponse.json(
      { error: "Parâmetros uf e mes são obrigatórios" },
      { status: 400 },
    );
  }

  const page =
    pageRaw != null ? Number.parseInt(pageRaw, 10) : undefined;
  const limit =
    limitRaw != null ? Number.parseInt(limitRaw, 10) : undefined;

  const db = getDb();

  try {
    const payload = await listMovimentacoesAprovadas(db, {
      uf,
      mes,
      page: page != null && !Number.isNaN(page) ? page : undefined,
      limit: limit != null && !Number.isNaN(limit) ? limit : undefined,
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof ParseMesFilterError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "uf inválida") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  let body: { ids?: string[] };
  try {
    body = (await request.json()) as { ids?: string[] };
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const ids = (body.ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma movimentação válida para excluir" },
      { status: 400 },
    );
  }

  const db = getDb();
  const result = await softDeleteMovimentacoes(db, ids);
  return NextResponse.json(result);
}
