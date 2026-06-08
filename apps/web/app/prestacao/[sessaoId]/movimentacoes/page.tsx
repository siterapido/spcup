import { redirect } from "next/navigation";

export default async function MovimentacoesPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  redirect(`/prestacao/${sessaoId}/planilha`);
}
