import {
  ExportBlockedError,
  exportPrestacaoZip,
  XsdValidationError,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = new URL(request.url);
  const uf = searchParams.get("uf");
  const exercicioRaw = searchParams.get("exercicio");
  const cnpjPrestador = searchParams.get("cnpj_prestador");

  if (!uf?.trim() || !exercicioRaw || !cnpjPrestador?.trim()) {
    return NextResponse.json(
      { error: "Parâmetros uf, exercicio e cnpj_prestador são obrigatórios" },
      { status: 400 },
    );
  }

  const exercicio = Number.parseInt(exercicioRaw, 10);
  if (Number.isNaN(exercicio)) {
    return NextResponse.json({ error: "exercicio inválido" }, { status: 400 });
  }

  const db = getDb();

  try {
    const { buffer, filename } = await exportPrestacaoZip(
      db,
      cnpjPrestador.trim(),
      uf.trim().toUpperCase(),
      exercicio,
    );
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ExportBlockedError) {
      return NextResponse.json({ detail: error.message }, { status: 403 });
    }
    if (error instanceof XsdValidationError) {
      return NextResponse.json(
        {
          message: "XML inválido contra XSD SPCA; exportação não publicada.",
          errors: error.errorsByFile,
        },
        { status: 422 },
      );
    }
    throw error;
  }
}
