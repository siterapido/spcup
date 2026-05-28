import { handlePaginaPdfImagem } from "@/lib/pagina-pdf-route";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handlePaginaPdfImagem(params);
}
