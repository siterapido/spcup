import { KanbanBoard } from "@/components/prestacao/kanban-board";

export default async function KanbanPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <KanbanBoard sessaoId={sessaoId} />
    </main>
  );
}
