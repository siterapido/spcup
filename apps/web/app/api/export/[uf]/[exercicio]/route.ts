import { ExportBlockedError, exportSpcaZip, XsdValidationError } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ uf: string; exercicio: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { uf, exercicio: exercicioRaw } = await context.params;
  const exercicio = Number.parseInt(exercicioRaw, 10);
  if (Number.isNaN(exercicio)) {
    return NextResponse.json({ error: "exercicio inválido" }, { status: 400 });
  }

  const db = getDb();

  try {
    const { buffer, filename } = await exportSpcaZip(db, uf, exercicio);
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
    if (error instanceof Error && error.message.includes("não cadastrado")) {
      return NextResponse.json({ detail: error.message }, { status: 404 });
    }
    throw error;
  }
}
