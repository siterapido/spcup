import { handleProcessarPaginaPdf } from "@/lib/pagina-pdf-route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handleProcessarPaginaPdf(request, params, "texto");
}
