import { PrestacaoFlowOverview } from "@/components/prestacao/prestacao-flow-overview";
import { SystemStatsPanel } from "@/components/dashboard/system-stats-panel";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getSystemStats } from "@spc-up/core";
import { getDb } from "@spc-up/db";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const uf = (params.uf ?? "SP").toUpperCase();
  const exercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  let stats: Awaited<ReturnType<typeof getSystemStats>> | null = null;
  try {
    const db = getDb();
    stats = await getSystemStats(db, { uf, exercicio });
  } catch {
    stats = null;
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Prestação de Contas</h1>
          <p className="mt-1 text-sm text-muted">Painel operacional — equipe nacional</p>
        </div>
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="block text-sm">
            UF
            <Input name="uf" defaultValue={uf} maxLength={2} className="mt-1 w-20" />
          </label>
          <label className="block text-sm">
            Exercício
            <Input
              name="exercicio"
              type="number"
              defaultValue={exercicio}
              className="mt-1 w-28"
            />
          </label>
          <Button type="submit" variant="outline" className="mb-0.5">
            Aplicar filtro
          </Button>
        </form>
      </div>

      {stats ? <SystemStatsPanel stats={stats} /> : null}

      <Card>
        <CardTitle>Fluxo guiado</CardTitle>
        <PrestacaoFlowOverview />
      </Card>
    </main>
  );
}
