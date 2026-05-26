import { listCadastroConflitos } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";
import { maskDocumento } from "@/lib/mask-document";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const status =
    new URL(request.url).searchParams.get("status")?.toUpperCase() ?? "PENDENTE";

  const db = getDb();
  const rows = await listCadastroConflitos(db, status);

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      documento: row.documento,
      documento_mascarado: maskDocumento(
        row.tipo as "PF" | "PJ",
        row.documento,
      ),
      nome_existente: row.nomeExistente,
      nome_proposto: row.nomeProposto,
      origem: row.origem,
      status: row.status,
      uf_contexto: row.ufContexto,
      exercicio_contexto: row.exercicioContexto,
      created_at: row.createdAt,
    })),
    total: rows.length,
  });
}
