import { handlePaginaPdfImagem, paginaPdfRuntime } from "@/lib/pagina-pdf-route";

export const runtime = paginaPdfRuntime;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handlePaginaPdfImagem(params);
}
