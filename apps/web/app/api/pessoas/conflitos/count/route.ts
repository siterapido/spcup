import { listCadastroConflitos } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function GET() {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const db = getDb();
  const items = await listCadastroConflitos(db, "PENDENTE");

  return NextResponse.json({ pendentes: items.length });
}
