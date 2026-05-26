import { isPlaceholderCnpjPrestador, listDiretoriosEstaduais } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = new URL(request.url);
  const ufFilter = searchParams.get("uf")?.toUpperCase();
  const ativoOnly = searchParams.get("ativoOnly") !== "false";

  const db = getDb();
  let items = await listDiretoriosEstaduais(db, { ativoOnly });
  if (ufFilter) {
    items = items.filter((r) => r.uf === ufFilter);
  }

  return NextResponse.json({
    items: items.map((row) => ({
      id: row.id,
      uf: row.uf,
      nome: row.nome,
      cnpjPrestador: row.cnpjPrestador,
      ativo: row.ativo,
      placeholder: isPlaceholderCnpjPrestador(row.cnpjPrestador),
    })),
  });
}
