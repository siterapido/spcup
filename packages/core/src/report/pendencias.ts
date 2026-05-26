/** Pendencias CSV report for UF/exercicio (spec section 7.3). */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { and, eq, notInArray, or } from "drizzle-orm";

import {
  arquivoIngestao,
  movimentacao,
  movimentacaoSpca,
  type Db,
} from "@spc-up/db";

import { REQUIRED_SPCA_FIELDS } from "../confidence";

const EXPORTABLE_STATUSES = ["CONFIRMADO", "EXPORTADO"] as const;

export const CSV_COLUMNS = [
  "data",
  "valor",
  "descricao",
  "motivo",
  "campos_xsd_faltantes",
  "arquivo_origem",
] as const;

type SpcaRow = typeof movimentacaoSpca.$inferSelect;

function missingSpcaFields(spca: SpcaRow | null | undefined): string[] {
  if (spca == null) {
    return [...REQUIRED_SPCA_FIELDS];
  }

  const fieldMap: Record<(typeof REQUIRED_SPCA_FIELDS)[number], keyof SpcaRow> = {
    fonte_recurso: "fonteRecurso",
    natureza_recurso: "naturezaRecurso",
    tipo_origem_recurso: "tipoOrigemRecurso",
  };

  return REQUIRED_SPCA_FIELDS.filter((field) => {
    const key = fieldMap[field];
    const value = spca[key];
    return value == null || value === "";
  });
}

function pendenciaMotivo(
  status: string,
  bloqueioExport: boolean,
  confiancaGlobal: number,
  missingFields: string[],
): string {
  const reasons: string[] = [];
  if (!EXPORTABLE_STATUSES.includes(status as (typeof EXPORTABLE_STATUSES)[number])) {
    reasons.push(`status=${status}`);
  }
  if (bloqueioExport && missingFields.length > 0) {
    reasons.push("campos_xsd_obrigatorios_faltantes");
  } else if (bloqueioExport) {
    reasons.push("bloqueio_export");
  }
  if (confiancaGlobal < 0.6) {
    reasons.push("confianca_baixa");
  }
  return reasons.length > 0 ? reasons.join("; ") : "pendencia";
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write pendencias CSV and return the number of rows written. */
export async function generatePendenciasCsv(
  db: Db,
  uf: string,
  exercicio: number,
  outputPath: string,
): Promise<number> {
  const ufUpper = uf.toUpperCase();

  const rows = await db
    .select({
      dataMovimento: movimentacao.dataMovimento,
      valor: movimentacao.valor,
      descricaoRaw: movimentacao.descricaoRaw,
      status: movimentacao.status,
      bloqueioExport: movimentacao.bloqueioExport,
      confiancaGlobal: movimentacao.confiancaGlobal,
      spca: movimentacaoSpca,
      nomeArquivo: arquivoIngestao.nomeArquivo,
    })
    .from(movimentacao)
    .leftJoin(movimentacaoSpca, eq(movimentacaoSpca.movimentacaoId, movimentacao.id))
    .leftJoin(arquivoIngestao, eq(arquivoIngestao.id, movimentacao.arquivoIngestaoId))
    .where(
      and(
        eq(movimentacao.uf, ufUpper),
        eq(movimentacao.exercicio, exercicio),
        or(
          notInArray(movimentacao.status, [...EXPORTABLE_STATUSES]),
          eq(movimentacao.bloqueioExport, true),
        ),
      ),
    )
    .orderBy(movimentacao.dataMovimento, movimentacao.id);

  await mkdir(dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(outputPath, { encoding: "utf-8" });
    stream.on("error", reject);
    stream.on("finish", () => resolve());

    stream.write(`${CSV_COLUMNS.join(",")}\n`);

    for (const row of rows) {
      const missing = missingSpcaFields(row.spca);
      const line = [
        row.dataMovimento,
        Number(row.valor).toFixed(2),
        escapeCsv(row.descricaoRaw),
        escapeCsv(
          pendenciaMotivo(
            row.status,
            row.bloqueioExport,
            row.confiancaGlobal,
            missing,
          ),
        ),
        escapeCsv(missing.join(",")),
        escapeCsv(row.nomeArquivo ?? ""),
      ].join(",");
      stream.write(`${line}\n`);
    }

    stream.end();
  });

  return rows.length;
}
