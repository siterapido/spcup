import { listPlanilhaForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { notFound } from "next/navigation";

import { PlanilhaView } from "@/components/prestacao/planilha-table";
import { Card, CardTitle } from "@/components/ui/card";

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
          <CardTitle>Planilha unificada</CardTitle>
          <p className="mt-1 text-sm text-muted">
            Vincule PF/PJ, resolva merges pendentes e libere a exportação quando todas as linhas
            estiverem prontas.
          </p>
          <p className="mt-1 text-xs text-muted">
            {payload.sessao.uf} · exercício {payload.sessao.exercicio} · sessão {sessaoId}
          </p>
        </div>
        <PlanilhaView sessaoId={sessaoId} initial={payload} />
      </Card>
    </main>
  );
}
