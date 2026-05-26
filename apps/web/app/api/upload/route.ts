import { getDiretorio, ingestFileBuffer } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = new Set([".ofx", ".xlsx", ".xls", ".pdf"]);

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const form = await request.formData();
  const uf = String(form.get("uf") ?? "").toUpperCase();
  const exercicioRaw = form.get("exercicio");
  const file = form.get("file");

  if (!uf || exercicioRaw == null || !(file instanceof File)) {
    return NextResponse.json(
      { error: "uf, exercicio e file são obrigatórios" },
      { status: 400 },
    );
  }

  const exercicio = Number.parseInt(String(exercicioRaw), 10);
  if (Number.isNaN(exercicio)) {
    return NextResponse.json({ error: "exercicio inválido" }, { status: 400 });
  }

  const name = file.name;
  const suffix = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.has(suffix)) {
    return NextResponse.json(
      { error: `Formato não suportado. Use: ${[...ALLOWED].join(", ")}` },
      { status: 400 },
    );
  }

  const db = getDb();
  const diretorio = await getDiretorio(db, uf);
  if (!diretorio) {
    return NextResponse.json(
      { error: `Diretório estadual não cadastrado para UF=${uf}` },
      { status: 404 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const blobPath = `${uf}/${exercicio}/${randomUUID()}/${name}`;

  let caminhoStorage: string;
  try {
    const blob = await put(blobPath, buffer, {
      access: "public",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    caminhoStorage = blob.url;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao gravar no Blob",
      },
      { status: 500 },
    );
  }

  try {
    const result = await ingestFileBuffer(db, {
      diretorioId: diretorio.id,
      uf,
      exercicio,
      filename: name,
      buffer,
      caminhoStorage,
    });
    return NextResponse.json({
      uf,
      exercicio,
      arquivo: name,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
