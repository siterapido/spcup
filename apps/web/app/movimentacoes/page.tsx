import { MovimentacoesTable } from "@/components/movimentacoes-table";
import { Card, CardTitle } from "@/components/ui/card";

export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const uf = (params.uf ?? "SP").toUpperCase();
  const exercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Movimentações</h1>
      <p className="mt-1 text-sm text-muted">
        Revise pendências e confirme lançamentos antes da exportação SPCA.
      </p>
      <Card className="mt-6">
        <CardTitle>Listagem</CardTitle>
        <div className="mt-4">
          <MovimentacoesTable initialUf={uf} initialExercicio={exercicio} />
        </div>
      </Card>
    </main>
  );
}
