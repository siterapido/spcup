import {
  rematchPendingMovimentacoes,
  searchPessoas,
  upsertPessoa,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";
import { maskDocumento } from "@/lib/mask-document";
import { parsePessoaTipoParam } from "@/lib/parse-pessoa-tipo";

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const tipo = parsePessoaTipoParam(searchParams.get("tipo"));

  const db = getDb();
  const rows = await searchPessoas(db, q, tipo ?? undefined);

  return NextResponse.json({
    items: rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      documento: row.documento,
      documento_mascarado: maskDocumento(row.tipo, row.documento),
      nome: row.nome,
      movimentacoes_count: row.movimentacoes_count,
    })),
    total: rows.length,
  });
}

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const body = (await request.json()) as {
    tipo?: string;
    documento?: string;
    nome?: string;
    uf?: string;
    exercicio?: number;
    tituloEleitor?: string;
  };

  const tipo = parsePessoaTipoParam(body.tipo);
  const documento = body.documento?.trim();
  const nome = body.nome?.trim();
  const uf = body.uf?.trim().toUpperCase();
  const exercicio = body.exercicio;

  if (!tipo || !documento || !nome || !uf || exercicio == null) {
    return NextResponse.json(
      { error: "Campos obrigatórios: tipo, documento, nome, uf, exercicio" },
      { status: 400 },
    );
  }

  const db = getDb();
  try {
    const result = await upsertPessoa(
      db,
      {
        tipo,
        documento,
        nome,
        ...(tipo === "PF" && body.tituloEleitor != null
          ? { tituloEleitor: body.tituloEleitor }
          : {}),
      },
      {
        uf,
        exercicio,
        origem: "MANUAL",
      },
    );

    if (result.action === "conflict") {
      return NextResponse.json(
        {
          error: "Conflito de nome com cadastro existente",
          conflitoId: result.conflitoId,
        },
        { status: 409 },
      );
    }

    if (result.action === "inserted" || result.action === "updated") {
      await rematchPendingMovimentacoes(db, uf, exercicio);
    }

    return NextResponse.json({
      action: result.action,
      pessoa_fisica_id: result.pessoaFisicaId ?? null,
      pessoa_juridica_id: result.pessoaJuridicaId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
