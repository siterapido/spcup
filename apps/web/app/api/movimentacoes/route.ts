import { canExport, softDeleteMovimentacoes } from "@spc-up/core";
import { getDb, movimentacao } from "@spc-up/db";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = new URL(request.url);
  const uf = searchParams.get("uf")?.toUpperCase();
  const exercicioRaw = searchParams.get("exercicio");
  const status = searchParams.get("status");
  const minScoreRaw = searchParams.get("min_score");

  if (!uf || !exercicioRaw) {
    return NextResponse.json(
      { error: "Parâmetros uf e exercicio são obrigatórios" },
      { status: 400 },
    );
  }

  const exercicio = Number.parseInt(exercicioRaw, 10);
  if (Number.isNaN(exercicio)) {
    return NextResponse.json({ error: "exercicio inválido" }, { status: 400 });
  }

  const db = getDb();
  const conditions = [
    eq(movimentacao.uf, uf),
    eq(movimentacao.exercicio, exercicio),
    isNull(movimentacao.deletedAt),
  ];
  if (status) conditions.push(eq(movimentacao.status, status));
  if (minScoreRaw != null) {
    const minScore = Number.parseFloat(minScoreRaw);
    if (!Number.isNaN(minScore)) {
      conditions.push(gte(movimentacao.confiancaGlobal, minScore));
    }
  }

  const rows = await db.query.movimentacao.findMany({
    where: and(...conditions),
    orderBy: [desc(movimentacao.dataMovimento)],
    with: { pessoaFisica: true, pessoaJuridica: true },
  });

  const items = rows.map((m) => ({
    id: m.id,
    uf: m.uf,
    exercicio: m.exercicio,
    direcao: m.direcao,
    valor: m.valor,
    data_movimento: m.dataMovimento,
    descricao_raw: m.descricaoRaw,
    cred_dev: m.credDev,
    status: m.status,
    confianca_global: m.confiancaGlobal,
    bloqueio_export: m.bloqueioExport,
    pessoa_nome:
      m.pessoaFisica?.nome ?? m.pessoaJuridica?.razaoSocial ?? null,
  }));

  const exportavel = await canExport(db, uf, exercicio);

  return NextResponse.json({
    uf,
    exercicio,
    exportavel,
    total: items.length,
    items,
  });
}

export async function DELETE(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  let body: { ids?: string[] };
  try {
    body = (await request.json()) as { ids?: string[] };
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const ids = (body.ids ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma movimentação válida para excluir" },
      { status: 400 },
    );
  }

  const db = getDb();
  const result = await softDeleteMovimentacoes(db, ids);
  return NextResponse.json(result);
}
