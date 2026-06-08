import { listPlanilhaForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";

import { PlanilhaView } from "@/components/prestacao/planilha-view";

export default async function PlanilhaPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  const db = getDb();
  const payload = await listPlanilhaForSessao(db, sessaoId);
  if (!payload) throw new Error("Sessão não encontrada");

  return (
    <main className="mx-auto max-w-[min(96rem,100%)] px-4 py-10">
      <PlanilhaView sessaoId={sessaoId} initial={payload} />
    </main>
  );
}
