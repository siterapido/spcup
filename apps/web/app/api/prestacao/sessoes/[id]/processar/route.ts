import {
  parseExtratoColumnMap,
  processSessaoPdfArquivos,
  ResolveArquivoBaseError,
  validateExtratoColumnMapPerPdf,
  validateExtratoColumnMapsSession,
  type ExtratoColumnMap,
  type ExtratoModeloId,
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
  let extratoModeloIds: Record<string, ExtratoModeloId> | undefined;
  let arquivoBaseIngestaoId: string | undefined;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as {
        extratoColumnMaps?: Record<string, unknown>;
        extratoModeloIds?: Record<string, unknown>;
        arquivoBaseIngestaoId?: string;
      };

      const parsedMaps = parseExtratoColumnMapsBody(body.extratoColumnMaps);
      if (!parsedMaps.ok) {
        return NextResponse.json({ error: parsedMaps.error }, { status: 400 });
      }
      extratoColumnMaps =
        Object.keys(parsedMaps.maps).length > 0 ? parsedMaps.maps : undefined;

      if (body.extratoModeloIds && typeof body.extratoModeloIds === "object" && !Array.isArray(body.extratoModeloIds)) {
        const models: Record<string, ExtratoModeloId> = {};
        for (const [key, value] of Object.entries(body.extratoModeloIds)) {
          if (value === "caixa_pix" || value === "caixa_total" || value === "outro") {
            models[key] = value as ExtratoModeloId;
          } else {
            return NextResponse.json({ error: `Modelo inválido: ${value}` }, { status: 400 });
          }
        }
        extratoModeloIds = Object.keys(models).length > 0 ? models : undefined;
      }

      if (
        typeof body.arquivoBaseIngestaoId === "string" &&
        body.arquivoBaseIngestaoId.trim().length > 0
      ) {
        arquivoBaseIngestaoId = body.arquivoBaseIngestaoId.trim();
      }
    } catch {
      return NextResponse.json(
        { error: "Corpo JSON inválido" },
        { status: 400 },
      );
    }
  }

  try {
    const result = await processSessaoPdfArquivos(db, id, {
      extratoColumnMaps,
      extratoModeloIds,
      arquivoBaseIngestaoId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ResolveArquivoBaseError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro no processamento da sessão" },
      { status: 500 },
    );
  }
}
