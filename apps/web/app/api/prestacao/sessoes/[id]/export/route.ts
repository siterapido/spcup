import {
  ExportBlockedError,
  exportPrestacaoZip,
  getSessao,
  prestadorFromSessao,
  XsdValidationError,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();
  const sessao = await getSessao(db, id);
  if (!sessao) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const prestador = prestadorFromSessao(sessao);

  try {
    const { buffer, filename } = await exportPrestacaoZip(
      db,
      prestador.cnpjPrestador,
      sessao.uf,
      sessao.exercicio,
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
