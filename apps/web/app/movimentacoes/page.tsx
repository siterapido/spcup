import { MovimentacoesTable } from "@/components/movimentacoes-table";
import { Card, CardTitle } from "@/components/ui/card";

export default async function MovimentacoesPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; mes?: string }>;
}) {
  const params = await searchParams;
  const initialUf = params.uf?.toUpperCase();
  const initialMes = params.mes;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Movimentações</h1>
      <p className="mt-1 text-sm text-muted">
        Movimentações confirmadas e exportadas. Para revisar pendências, use a planilha da
        prestação.
      </p>
      <Card className="mt-6">
        <CardTitle>Listagem</CardTitle>
        <div className="mt-4">
          <MovimentacoesTable initialUf={initialUf} initialMes={initialMes} />
        </div>
      </Card>
    </main>
  );
}
