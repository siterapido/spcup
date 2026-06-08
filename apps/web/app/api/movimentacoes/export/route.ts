import {
  buildMovimentacoesCsvBuffer,
  buildMovimentacoesXlsxBuffer,
  listAllMovimentacoesAprovadas,
  ParseMesFilterError,
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
  const mes = searchParams.get("mes");
  const formato = searchParams.get("formato")?.toLowerCase();

  if (!uf?.trim() || !mes?.trim()) {
    return NextResponse.json(
      { error: "Parâmetros uf e mes são obrigatórios" },
      { status: 400 },
    );
  }

  if (formato !== "csv" && formato !== "xlsx") {
    return NextResponse.json(
      { error: "formato deve ser csv ou xlsx" },
      { status: 400 },
    );
  }

  const db = getDb();
  const ufNorm = uf.trim().toUpperCase();
  const mesNorm = mes.trim();

  try {
    const rows = await listAllMovimentacoesAprovadas(db, {
      uf: ufNorm,
      mes: mesNorm,
    });

    const filename = `movimentacoes_${ufNorm}_${mesNorm}.${formato}`;

    if (formato === "csv") {
      const buffer = buildMovimentacoesCsvBuffer(rows);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buffer = await buildMovimentacoesXlsxBuffer(rows);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ParseMesFilterError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.message === "uf inválida") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof Error &&
      error.message.includes("limite de exportação")
    ) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }
}
