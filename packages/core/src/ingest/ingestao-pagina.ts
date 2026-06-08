import type { Db } from "@spc-up/db";
import { ingestaoPagina } from "@spc-up/db";

import type { IngestaoPaginaStatus } from "./dual-extract";

export async function upsertIngestaoPagina(
  db: Db,
  arquivoId: string,
  pagina: number,
  fields: {
    status: IngestaoPaginaStatus;
    modo: "texto" | "imagem";
    aceitas: number;
    incertas: number;
    motivo?: string;
    textoAmostra?: string;
  },
): Promise<void> {
  const now = new Date();
  await db
    .insert(ingestaoPagina)
    .values({
      arquivoIngestaoId: arquivoId,
      pagina,
      status: fields.status,
      modo: fields.modo,
      aceitas: fields.aceitas,
      incertas: fields.incertas,
      motivo: fields.motivo ?? null,
      textoAmostra: fields.textoAmostra ?? null,
      processadoEm: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ingestaoPagina.arquivoIngestaoId, ingestaoPagina.pagina],
      set: {
        status: fields.status,
        modo: fields.modo,
        aceitas: fields.aceitas,
        incertas: fields.incertas,
        motivo: fields.motivo ?? null,
        textoAmostra: fields.textoAmostra ?? null,
        processadoEm: now,
        updatedAt: now,
      },
    });
}
