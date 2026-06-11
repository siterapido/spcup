import { listPlanilhaForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { notFound } from "next/navigation";

import { PlanilhaView } from "@/components/prestacao/planilha-table";
import { Card, CardTitle } from "@/components/ui/card";

function formatMesReferencia(mesReferencia?: string | null): string {
  if (!mesReferencia) return "";
  const parts = mesReferencia.split("-");
  if (parts.length !== 2) return "";
  const [ano, mes] = parts;
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const mesIndex = Number.parseInt(mes!, 10) - 1;
  if (mesIndex < 0 || mesIndex > 11) return "";
  return `${meses[mesIndex]}/${ano}`;
}

function formatIsoDateBr(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatPeriodoPrestacao(periodo?: { dataInicio: string; dataFim: string } | null) {
  if (!periodo) return "";
  if (periodo.dataInicio === periodo.dataFim) {
    return formatIsoDateBr(periodo.dataInicio);
  }
  return `${formatIsoDateBr(periodo.dataInicio)} a ${formatIsoDateBr(periodo.dataFim)}`;
}

export default async function PlanilhaPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  const db = getDb();
  const payload = await listPlanilhaForSessao(db, sessaoId);
  if (!payload) notFound();

  return (
    <main className="mx-auto max-w-[min(96rem,100%)] px-4 py-10">
      <Card className="space-y-6">
        <div>
          <CardTitle>
            Prestação {payload.sessao.uf} {payload.sessao.exercicio}
            {payload.sessao.periodo
              ? ` — ${formatPeriodoPrestacao(payload.sessao.periodo)}`
              : payload.sessao.mesReferencia
                ? ` — ${formatMesReferencia(payload.sessao.mesReferencia)}`
                : ""}
          </CardTitle>
          {payload.sessao.periodo && payload.sessao.mesReferencia ? (
            <p className="mt-1 text-sm text-muted">
              Mês de referência: {formatMesReferencia(payload.sessao.mesReferencia)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-muted">
            Vincule PF/PJ, resolva merges pendentes e libere a exportação quando todas as linhas
            estiverem prontas.
          </p>
          <p className="mt-1 text-xs text-muted">
            Sessão {sessaoId}
          </p>
        </div>
        <PlanilhaView sessaoId={sessaoId} initial={payload} />
      </Card>
    </main>
  );
}
