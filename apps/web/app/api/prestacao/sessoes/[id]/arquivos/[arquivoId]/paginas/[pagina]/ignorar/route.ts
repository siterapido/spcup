import { handleIgnorarPaginaPdf } from "@/lib/pagina-pdf-route";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handleIgnorarPaginaPdf(params);
}
