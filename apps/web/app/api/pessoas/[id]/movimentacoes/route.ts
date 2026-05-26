import { countPessoaMovimentacoes, listPessoaMovimentacoes } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";
import { parsePessoaTipoParam } from "@/lib/parse-pessoa-tipo";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const tipo = parsePessoaTipoParam(new URL(request.url).searchParams.get("tipo"));
  if (!tipo) {
    return NextResponse.json({ error: "Parâmetro tipo=pf|pj obrigatório" }, { status: 400 });
  }

  const db = getDb();
  const [movimentacoes, resumo] = await Promise.all([
    listPessoaMovimentacoes(db, id, tipo),
    countPessoaMovimentacoes(db, id, tipo),
  ]);

  return NextResponse.json({
    resumo,
    items: movimentacoes.map((m) => ({
      id: m.id,
      uf: m.uf,
      exercicio: m.exercicio,
      data_movimento: m.dataMovimento,
      direcao: m.direcao,
      valor: m.valor,
      descricao_raw: m.descricaoRaw,
      status: m.status,
      confianca_global: m.confiancaGlobal,
    })),
  });
}
