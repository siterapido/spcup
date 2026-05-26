import {
  importDiretoriosMunicipais,
  listDiretoriosMunicipais,
  upsertDiretorioMunicipal,
} from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/api-auth";

const upsertSchema = z.object({
  uf: z.string().length(2),
  codigoIbge: z.string().optional(),
  nomeMunicipio: z.string().min(1),
  cnpjPrestador: z.string().min(14),
  ativo: z.boolean().optional(),
});

export async function GET(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const url = new URL(request.url);
  const uf = url.searchParams.get("uf");
  if (!uf) {
    return NextResponse.json({ error: "uf é obrigatório" }, { status: 400 });
  }

  const q = url.searchParams.get("q") ?? undefined;
  const db = getDb();
  const items = await listDiretoriosMunicipais(db, uf, { q, ativoOnly: true });

  return NextResponse.json({
    items: items.map((d) => ({
      id: d.id,
      uf: d.uf,
      codigoIbge: d.codigoIbge,
      nomeMunicipio: d.nomeMunicipio,
      cnpjPrestador: d.cnpjPrestador,
      ativo: d.ativo,
    })),
  });
}

export async function POST(request: Request) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file obrigatório" }, { status: 400 });
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0]?.toLowerCase() ?? "";
    const rows = lines.slice(1).map((line) => {
      const parts = line.split(/[,;]/).map((p) => p.trim());
      if (header.includes("codigo")) {
        return {
          uf: parts[0] ?? "",
          codigo_ibge: parts[1],
          nome_municipio: parts[2] ?? "",
          cnpj_prestador: parts[3] ?? "",
        };
      }
      return {
        uf: parts[0] ?? "",
        nome_municipio: parts[1] ?? "",
        cnpj_prestador: parts[2] ?? "",
      };
    });

    const db = getDb();
    const result = await importDiretoriosMunicipais(db, rows);
    return NextResponse.json(result);
  }

  let body: z.infer<typeof upsertSchema>;
  try {
    body = upsertSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const db = getDb();
  try {
    const created = await upsertDiretorioMunicipal(db, body);
    return NextResponse.json({ item: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao salvar" },
      { status: 400 },
    );
  }
}
