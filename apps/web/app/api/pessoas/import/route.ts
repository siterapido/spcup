import { importCadastroBatch, parseCadastroSpreadsheet } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const form = await request.formData();
  const file = form.get("file");
  const uf = String(form.get("uf") ?? "")
    .trim()
    .toUpperCase();
  const exercicioRaw = form.get("exercicio");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (!uf || exercicioRaw == null) {
    return NextResponse.json(
      { error: "uf e exercicio são obrigatórios" },
      { status: 400 },
    );
  }

  const exercicio = Number.parseInt(String(exercicioRaw), 10);
  if (Number.isNaN(exercicio)) {
    return NextResponse.json({ error: "exercicio inválido" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const parsed = await parseCadastroSpreadsheet(buffer, file.name);
    const db = getDb();
    const result = await importCadastroBatch(db, parsed.ok, uf, exercicio);

    return NextResponse.json({
      ...result,
      erros: [...parsed.erros, ...result.erros],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na importação";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
