import { readArquivoIngestaoBuffer } from "@spc-up/core";
import { arquivoIngestao } from "@spc-up/db";
import { getDb } from "@spc-up/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) {
    return authResult.error;
  }

  const { id } = await context.params;
  const db = getDb();
  const arquivo = await db.query.arquivoIngestao.findFirst({
    where: eq(arquivoIngestao.id, id),
  });

  if (!arquivo) {
    return NextResponse.json({ error: "Arquivo não encontrado" }, { status: 404 });
  }

  if (!/\.pdf$/i.test(arquivo.nomeArquivo)) {
    return NextResponse.json({ error: "Não é um PDF" }, { status: 400 });
  }

  try {
    const buffer = await readArquivoIngestaoBuffer(arquivo.caminhoStorage);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${arquivo.nomeArquivo.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao carregar PDF",
      },
      { status: 500 },
    );
  }
}
