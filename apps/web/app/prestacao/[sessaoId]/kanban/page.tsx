import { redirect } from "next/navigation";

export default async function KanbanPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  redirect(`/prestacao/${sessaoId}/planilha`);
}
