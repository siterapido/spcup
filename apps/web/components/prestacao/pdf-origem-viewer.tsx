"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { BboxNorm } from "@spc-up/core";

type Props = {
  open: boolean;
  onClose: () => void;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
};

export function PdfOrigemViewer({
  open,
  onClose,
  arquivoIngestaoId,
  nomeArquivo,
  pagina,
  bbox,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    async function render() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

        const res = await fetch(`/api/arquivos-ingestao/${arquivoIngestaoId}/pdf`);
        if (!res.ok) {
          throw new Error("Não foi possível carregar o PDF");
        }
        const data = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(pagina);
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap || cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao renderizar PDF");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [open, arquivoIngestaoId, pagina]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-background p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="font-medium">{nomeArquivo}</p>
            <p className="text-sm text-muted">
              Página {pagina}
              {bbox ? ` · linha destacada` : ""}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
        {loading && <p className="text-sm text-muted">Carregando PDF…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div ref={wrapRef} className="relative max-h-[70vh] overflow-auto p-4 bg-slate-50/50 rounded-md border border-slate-100">
          <div className="relative mx-auto w-fit border border-slate-200 rounded-md shadow-lg overflow-hidden bg-white">
            <canvas ref={canvasRef} className="block" />
            {bbox && (
              <div
                className="pointer-events-none absolute border-2 border-amber-500 bg-amber-400/20"
                style={{
                  left: `${bbox.x * 100}%`,
                  top: `${bbox.y * 100}%`,
                  width: `${bbox.w * 100}%`,
                  height: `${bbox.h * 100}%`,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
