import { handleIgnorarPaginaPdf, paginaPdfRuntime } from "@/lib/pagina-pdf-route";

export const runtime = paginaPdfRuntime;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handleIgnorarPaginaPdf(params);
}
