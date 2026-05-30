import { MovimentacoesList } from "@/components/prestacao/movimentacoes-list";

export default async function MovimentacoesPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <MovimentacoesList sessaoId={sessaoId} />
    </main>
  );
}
