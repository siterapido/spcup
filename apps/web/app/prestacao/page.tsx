import { SessoesList } from "@/components/prestacao/sessoes-list";
import { Card, CardTitle } from "@/components/ui/card";

export default async function PrestacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const uf = (params.uf ?? "").toUpperCase();
  const exercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Prestações</h1>
      <p className="mt-1 text-sm text-muted">
        Consulte prestações já iniciadas, retome a revisão de movimentações ou acesse a
        consolidação de extratos.
      </p>
      <Card className="mt-6">
        <CardTitle>Histórico recente</CardTitle>
        <div className="mt-4">
          <SessoesList initialUf={uf} initialExercicio={exercicio} />
        </div>
      </Card>
    </main>
  );
}
