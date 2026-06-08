"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { usePdfTextLayer } from "@/hooks/use-pdf-text-layer";
import { loadPdfJs } from "@/lib/pdfjs-browser";

import { localizarLinhaPdf, type BboxNorm } from "@spc-up/core/browser";

export type HighlightMode = "extracao" | "estimada" | "none";

export type PdfOrigemPainelProps = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  papel?: string;
  paginaInicial: number;
  bbox?: BboxNorm;
  highlightMode: HighlightMode;
  indiceLinha?: number;
  dataMovimento: string;
  valor: string;
  descricaoRaw: string;
};

const CANVAS_SCALE = 1.5;

function legendaHighlight(mode: HighlightMode): string {
  switch (mode) {
    case "extracao":
      return "Extração";
    case "estimada":
      return "Localização estimada";
    case "none":
      return "Não localizado no PDF";
  }
}

export function PdfOrigemPainel({
  arquivoIngestaoId,
  nomeArquivo,
  papel,
  paginaInicial,
  bbox: bboxProp,
  highlightMode: highlightModeProp,
  indiceLinha,
  dataMovimento,
  valor,
  descricaoRaw,
}: PdfOrigemPainelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [paginaAtual, setPaginaAtual] = useState(paginaInicial);
  const [paginaOrigem, setPaginaOrigem] = useState(paginaInicial);
  const [bboxAtual, setBboxAtual] = useState<BboxNorm | undefined>(bboxProp);
  const [highlightModeAtual, setHighlightModeAtual] = useState<HighlightMode>(
    bboxProp ? highlightModeProp : "none",
  );
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderLoading, setRenderLoading] = useState(false);

  const { paginas, pageCount, loading: textLoading, error: textError } = usePdfTextLayer(
    arquivoIngestaoId,
    true,
  );

  const totalPaginas = pageCount > 0 ? pageCount : paginaInicial;

  useEffect(() => {
    setPaginaAtual(paginaInicial);
    setPaginaOrigem(paginaInicial);
    setBboxAtual(bboxProp);
    setHighlightModeAtual(bboxProp ? highlightModeProp : "none");
  }, [arquivoIngestaoId, paginaInicial, bboxProp, highlightModeProp]);

  useEffect(() => {
    if (bboxProp || textLoading || textError || paginas.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = localizarLinhaPdf({
        paginas,
        dataMovimento,
        valor,
        descricaoRaw,
      });

      if (cancelled) {
        return;
      }

      if (result?.encontrado) {
        setBboxAtual(result.bbox);
        setPaginaOrigem(result.pagina);
        setPaginaAtual(result.pagina);
        setHighlightModeAtual("estimada");
        return;
      }

      setHighlightModeAtual("none");
    })();

    return () => {
      cancelled = true;
    };
  }, [bboxProp, textLoading, textError, paginas, dataMovimento, valor, descricaoRaw]);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setRenderLoading(true);
      setRenderError(null);
      try {
        const pdfjs = await loadPdfJs();
        const res = await fetch(`/api/arquivos-ingestao/${arquivoIngestaoId}/pdf`);
        if (!res.ok) {
          throw new Error("Não foi possível carregar o PDF");
        }
        const data = await res.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(paginaAtual);
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap || cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: CANVAS_SCALE });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (!cancelled) {
          setRenderError(e instanceof Error ? e.message : "Erro ao renderizar PDF");
        }
      } finally {
        if (!cancelled) {
          setRenderLoading(false);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [arquivoIngestaoId, paginaAtual]);

  const showHighlight =
    bboxAtual != null &&
    highlightModeAtual !== "none" &&
    paginaAtual === paginaOrigem;

  const highlightClass =
    highlightModeAtual === "estimada"
      ? "border-2 border-blue-500 border-dashed bg-blue-400/15"
      : "border-2 border-amber-500 bg-amber-400/20";

  const loading = renderLoading || textLoading;
  const error = renderError ?? textError;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-background p-3">
      <div>
        <p className="text-sm font-medium">
          {papel ? `${papel} · ` : ""}
          {nomeArquivo}
        </p>
        {indiceLinha != null && (
          <p className="text-xs text-muted">Linha {indiceLinha}</p>
        )}
      </div>

      {loading && <p className="text-sm text-muted">Carregando PDF…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={paginaAtual <= 1}
          onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
          aria-label="Página anterior"
        >
          ‹
        </Button>
        <p className="text-sm text-muted">
          pág {paginaAtual} de {totalPaginas}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={pageCount > 0 ? paginaAtual >= pageCount : false}
          onClick={() => setPaginaAtual((p) => (pageCount > 0 ? Math.min(pageCount, p + 1) : p + 1))}
          aria-label="Próxima página"
        >
          ›
        </Button>
      </div>

      <div
        ref={wrapRef}
        className="relative max-h-[60vh] overflow-auto rounded-md border border-slate-100 bg-slate-50/50 p-2"
      >
        <div className="relative mx-auto w-fit overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          <canvas ref={canvasRef} className="block" />
          {showHighlight && bboxAtual && (
            <div
              className={`pointer-events-none absolute ${highlightClass}`}
              style={{
                left: `${bboxAtual.x * 100}%`,
                top: `${bboxAtual.y * 100}%`,
                width: `${bboxAtual.w * 100}%`,
                height: `${bboxAtual.h * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{legendaHighlight(highlightModeAtual)}</p>
        <Button
          type="button"
          variant="outline"
          disabled={paginaAtual === paginaOrigem}
          onClick={() => setPaginaAtual(paginaOrigem)}
        >
          Voltar à origem
        </Button>
      </div>
    </div>
  );
}
