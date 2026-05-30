import {
  createSessao,
  getSessao,
  listRecentSessoes,
  prestadorFromSessao,
  softDeleteSessoes,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const createSchema = z.object({
  uf: z.string().length(2),
  tipoPrestador: z.enum(["ESTADUAL", "MUNICIPAL"]),
  diretorioMunicipalId: z.string().uuid().optional(),
  exercicio: z.number().int(),
  consolidarExtratos: z.boolean().optional(),
});

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const ufParam = url.searchParams.get("uf")?.trim();
  const exercicioParam = url.searchParams.get("exercicio")?.trim();
  const exercicio =
    exercicioParam && exercicioParam.length > 0
      ? Number.parseInt(exercicioParam, 10)
      : undefined;

  const db = getDb();
  const sessoes = await listRecentSessoes(db, {
    limit: Number.isFinite(limit) ? limit : 50,
    uf: ufParam && ufParam.length === 2 ? ufParam : undefined,
    exercicio: exercicio != null && Number.isFinite(exercicio) ? exercicio : undefined,
  });

  return NextResponse.json({
    items: sessoes.map((s) => {
      const prestador = prestadorFromSessao({
        ...s,
        diretorioEstadual: s.diretorioEstadual,
        diretorioMunicipal: s.diretorioMunicipal,
      });
      return {
        id: s.id,
        uf: s.uf,
        tipoPrestador: s.tipoPrestador,
        exercicio: s.exercicio,
        status: s.status,
        cnpjPrestador: prestador.cnpjPrestador,
        prestadorNome:
          s.diretorioMunicipal?.nomeMunicipio ?? s.diretorioEstadual?.nome ?? "",
        consolidarExtratos: s.consolidarExtratos,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      };
    }),
  });
}

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  if (body.tipoPrestador === "MUNICIPAL" && !body.diretorioMunicipalId) {
    return NextResponse.json(
      { error: "diretorioMunicipalId obrigatório para prestação municipal" },
      { status: 400 },
    );
  }

  const db = getDb();
  try {
    const sessao = await createSessao(db, {
      uf: body.uf,
      tipoPrestador: body.tipoPrestador,
      diretorioMunicipalId: body.diretorioMunicipalId,
      exercicio: body.exercicio,
      consolidarExtratos: body.consolidarExtratos,
    });
    const full = await getSessao(db, sessao.id);
    const prestador = full ? prestadorFromSessao(full) : null;

    return NextResponse.json({
      id: sessao.id,
      uf: sessao.uf,
      tipoPrestador: sessao.tipoPrestador,
      exercicio: sessao.exercicio,
      cnpjPrestador: prestador?.cnpjPrestador,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao criar sessão" },
      { status: 400 },
    );
  }
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
      { error: "Nenhuma prestação válida para excluir" },
      { status: 400 },
    );
  }

  const db = getDb();
  const result = await softDeleteSessoes(db, ids);
  return NextResponse.json(result);
}
