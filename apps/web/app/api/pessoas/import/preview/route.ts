import { extractSpreadsheetHeaders } from "@spc-up/core";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const preview = await extractSpreadsheetHeaders(buffer, file.name);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao ler planilha";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
