import { getSessao, prestadorFromSessao, uploadFilesToSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";
import { persistUpload } from "@/lib/persist-upload";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id: sessaoId } = await context.params;
  const db = getDb();
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadualId || !sessao.diretorioEstadual) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const prestador = prestadorFromSessao(sessao);
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    const single = form.get("file");
    if (single instanceof File) {
      files.push(single);
    }
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const fileInputs = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    })),
  );

  const payload = await uploadFilesToSessao(db, {
    sessaoId,
    diretorioEstadualId: sessao.diretorioEstadualId,
    uf: sessao.uf,
    exercicio: sessao.exercicio,
    prestador: {
      cnpjPrestador: prestador.cnpjPrestador,
      tipoPrestador: prestador.tipoPrestador,
      sessaoPrestacaoId: sessaoId,
      diretorioMunicipalId: prestador.diretorioMunicipalId,
    },
    files: fileInputs,
    persistStorage: persistUpload,
  });

  if (payload.total_movimentacoes === 0 && payload.erros.length > 0) {
    return NextResponse.json(
      {
        error: "Nenhum arquivo foi processado com sucesso.",
        ...payload,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(payload);
}
