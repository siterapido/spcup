import { movimentacao, type Db } from "@spc-up/db";
import { and, eq, inArray, isNull, max, min } from "drizzle-orm";

export type PeriodoPrestacao = {
  dataInicio: string;
  dataFim: string;
};

function toIsoDate(value: unknown): string | null {
  if (value == null) return null;
  const iso = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

export function formatPeriodoPrestacao(periodo: PeriodoPrestacao): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  if (periodo.dataInicio === periodo.dataFim) {
    return fmt(periodo.dataInicio);
  }
  return `${fmt(periodo.dataInicio)} a ${fmt(periodo.dataFim)}`;
}

export async function getPeriodoPrestacao(
  db: Db,
  sessaoId: string,
): Promise<PeriodoPrestacao | null> {
  const [row] = await db
    .select({
      dataInicio: min(movimentacao.dataMovimento),
      dataFim: max(movimentacao.dataMovimento),
    })
    .from(movimentacao)
    .where(
      and(
        eq(movimentacao.sessaoPrestacaoId, sessaoId),
        isNull(movimentacao.deletedAt),
        isNull(movimentacao.movimentacaoCanonicaId),
      ),
    );

  const dataInicio = toIsoDate(row?.dataInicio);
  const dataFim = toIsoDate(row?.dataFim);
  if (!dataInicio || !dataFim) return null;
  return { dataInicio, dataFim };
}

export async function getPeriodosPrestacaoBatch(
  db: Db,
  sessaoIds: string[],
): Promise<Map<string, PeriodoPrestacao>> {
  const unique = [...new Set(sessaoIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const rows = await db
    .select({
      sessaoId: movimentacao.sessaoPrestacaoId,
      dataInicio: min(movimentacao.dataMovimento),
      dataFim: max(movimentacao.dataMovimento),
    })
    .from(movimentacao)
    .where(
      and(
        inArray(movimentacao.sessaoPrestacaoId, unique),
        isNull(movimentacao.deletedAt),
        isNull(movimentacao.movimentacaoCanonicaId),
      ),
    )
    .groupBy(movimentacao.sessaoPrestacaoId);

  const out = new Map<string, PeriodoPrestacao>();
  for (const row of rows) {
    if (!row.sessaoId) continue;
    const dataInicio = toIsoDate(row.dataInicio);
    const dataFim = toIsoDate(row.dataFim);
    if (!dataInicio || !dataFim) continue;
    out.set(row.sessaoId, { dataInicio, dataFim });
  }
  return out;
}
