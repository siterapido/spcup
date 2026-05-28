import {
  handleProcessarPaginaPdf,
  paginaPdfMaxDuration,
  paginaPdfRuntime,
} from "@/lib/pagina-pdf-route";

export const runtime = paginaPdfRuntime;
export const maxDuration = paginaPdfMaxDuration;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; arquivoId: string; pagina: string }> },
) {
  const params = await context.params;
  return handleProcessarPaginaPdf(request, params, "imagem");
}
