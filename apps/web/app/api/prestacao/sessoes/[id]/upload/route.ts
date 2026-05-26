import {
  classifyIngestError,
  getSessao,
  ingestFileBuffer,
  ingestLog,
  prestadorFromSessao,
} from "@spc-up/core";
import { getDb, sessaoPrestacao, SESSAO_STATUS } from "@spc-up/db";
import { put } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { requireSession } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const ALLOWED = new Set([".ofx", ".xlsx", ".xls", ".pdf"]);

type UploadErro = { nome: string; codigo: string; mensagem: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id: sessaoId } = await context.params;
  const db = getDb();
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.diretorioEstadualId || !sessao.diretorioEstadual) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }

  const prestador = prestadorFromSessao(sessao);
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    const single = form.get("file");
    if (single instanceof File) {
      files.push(single);
    }
  }
  if (files.length === 0) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.EM_PROCESSAMENTO })
    .where(eq(sessaoPrestacao.id, sessaoId));

  const results: Array<{
    nome: string;
    movimentacoes_criadas: number;
    linhas_ignoradas_sem_doc?: number;
  }> = [];
  const errors: UploadErro[] = [];

  for (const file of files) {
    const suffix = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED.has(suffix)) {
      errors.push({
        nome: file.name,
        codigo: "INGESTAO_DESCONHECIDA",
        mensagem: "Formato não suportado. Use PDF, Excel ou OFX.",
      });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const blobPath = `${sessao.uf}/${sessao.exercicio}/${sessaoId}/${randomUUID()}/${file.name}`;

    let caminhoStorage: string;
    try {
      const blob = await put(blobPath, buffer, {
        access: "public",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      caminhoStorage = blob.url;
    } catch (error) {
      const detail = classifyIngestError(
        error instanceof Error ? error : new Error("falha no storage"),
      );
      ingestLog("error", {
        fase: "storage",
        sessaoId,
        filename: file.name,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.name,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
      });
      continue;
    }

    try {
      const result = await ingestFileBuffer(db, {
        diretorioId: sessao.diretorioEstadualId,
        uf: sessao.uf,
        exercicio: sessao.exercicio,
        filename: file.name,
        buffer,
        caminhoStorage,
        sessaoPrestacaoId: sessaoId,
        prestador: {
          cnpjPrestador: prestador.cnpjPrestador,
          tipoPrestador: prestador.tipoPrestador,
          sessaoPrestacaoId: sessaoId,
          diretorioMunicipalId: prestador.diretorioMunicipalId,
        },
      });
      results.push({
        nome: file.name,
        movimentacoes_criadas: result.movimentacoes_criadas,
        ...(result.linhas_ignoradas_sem_doc != null && result.linhas_ignoradas_sem_doc > 0
          ? { linhas_ignoradas_sem_doc: result.linhas_ignoradas_sem_doc }
          : {}),
      });
    } catch (error) {
      const detail = classifyIngestError(error);
      ingestLog("error", {
        fase: "persist",
        sessaoId,
        filename: file.name,
        codigoErro: detail.codigo,
        causa: detail.causaTecnica,
      });
      errors.push({
        nome: file.name,
        codigo: detail.codigo,
        mensagem: detail.mensagem,
      });
    }
  }

  await db
    .update(sessaoPrestacao)
    .set({ status: SESSAO_STATUS.ABERTA, updatedAt: new Date() })
    .where(eq(sessaoPrestacao.id, sessaoId));

  const total_movimentacoes = results.reduce((s, r) => s + r.movimentacoes_criadas, 0);
  const payload = { arquivos: results, erros: errors, total_movimentacoes };

  if (total_movimentacoes === 0 && errors.length > 0) {
    return NextResponse.json(
      {
        error: "Nenhum arquivo foi processado com sucesso.",
        ...payload,
      },
      { status: 422 },
    );
  }

  return NextResponse.json(payload);
}
