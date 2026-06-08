import {
  parseExtratoColumnMap,
  processSessaoPdfArquivos,
  validateExtratoColumnMapPerPdf,
  validateExtratoColumnMapsSession,
  type ExtratoColumnMap,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

function parseExtratoColumnMapsBody(
  raw: unknown,
):
  | { ok: true; maps: Record<string, ExtratoColumnMap> }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: true, maps: {} };
  }

  const parsed: Record<string, ExtratoColumnMap> = {};
  for (const [arquivoId, value] of Object.entries(raw)) {
    const map = parseExtratoColumnMap(value);
    if (!map) {
      return { ok: false, error: `Mapa de colunas inválido para arquivo ${arquivoId}` };
    }
    const perPdf = validateExtratoColumnMapPerPdf(map);
    if (!perPdf.ok) {
      return { ok: false, error: perPdf.message };
    }
    parsed[arquivoId] = map;
  }

  if (Object.keys(parsed).length === 0) {
    return { ok: true, maps: {} };
  }

  const session = validateExtratoColumnMapsSession(Object.values(parsed));
  if (!session.ok) {
    return { ok: false, error: session.message };
  }

  return { ok: true, maps: parsed };
}

export async function POST(
  request: Request,
  context: RouteContext,
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();

  let extratoColumnMaps: Record<string, ExtratoColumnMap> | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as {
        extratoColumnMaps?: Record<string, unknown>;
      };
      const parsedMaps = parseExtratoColumnMapsBody(body.extratoColumnMaps);
      if (!parsedMaps.ok) {
        return NextResponse.json({ error: parsedMaps.error }, { status: 400 });
      }
      extratoColumnMaps =
        Object.keys(parsedMaps.maps).length > 0 ? parsedMaps.maps : undefined;
    } catch {
      return NextResponse.json(
        { error: "Corpo JSON inválido" },
        { status: 400 },
      );
    }
  }

  try {
    const result = await processSessaoPdfArquivos(db, id, { extratoColumnMaps });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro no processamento da sessão" },
      { status: 500 },
    );
  }
}
