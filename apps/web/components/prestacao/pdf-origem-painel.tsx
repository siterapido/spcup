"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { usePdfTextLayer } from "@/hooks/use-pdf-text-layer";
import { loadPdfJs } from "@/lib/pdfjs-browser";

import {
  localizarLinhaPdf,
  type BboxNorm,
  type OrigemAncoragem,
} from "@spc-up/core/browser";

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
  remetenteDestinatario?: string | null;
  documento?: string | null;
  hora?: string | null;
  relaxarDataNaLinha?: boolean;
  /** Ingest tentou ancorar e não achou linha — não estimar por índice */
  ancoragem?: OrigemAncoragem | null;
  allowEstimatedHighlight?: boolean;
  /**
   * Sem bbox: tenta localizar linha no PDF.
   * - text: só busca por data/valor/texto
   * - row-index: só faixa por indiceLinha
   * - text-then-row-index: busca texto, depois índice
   */
  highlightFallback?: "none" | "text" | "row-index" | "text-then-row-index";
  /** Oculta cabeçalho duplicado quando embutido em outro painel */
  compact?: boolean;
  /** Preenche altura do container pai (comparador lado a lado) */
  fillHeight?: boolean;
  destaqueOrigem?: {
    pagina: number;
    indiceLinha?: number;
    bbox?: BboxNorm;
  };
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
  remetenteDestinatario,
  documento,
  hora,
  relaxarDataNaLinha = false,
  ancoragem = null,
  allowEstimatedHighlight = true,
  highlightFallback,
  compact = false,
  fillHeight = false,
  destaqueOrigem,
}: PdfOrigemPainelProps) {
  const fallbackMode =
    highlightFallback ??
    (allowEstimatedHighlight ? "text-then-row-index" : "none");
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
    const pag = destaqueOrigem?.pagina ?? paginaInicial;
    const box = destaqueOrigem?.bbox ?? bboxProp;
    setPaginaAtual(pag);
    setPaginaOrigem(pag);
    setBboxAtual(box);
    setHighlightModeAtual(box ? "extracao" : (bboxProp ? highlightModeProp : "none"));
  }, [arquivoIngestaoId, paginaInicial, bboxProp, highlightModeProp, destaqueOrigem]);

  useEffect(() => {
    if (bboxProp) {
      return;
    }

    if (ancoragem === "nao_localizado") {
      setHighlightModeAtual("none");
      setBboxAtual(undefined);
      return;
    }

    if (textLoading) {
      return;
    }

    if (fallbackMode === "none") {
      setHighlightModeAtual("none");
      setBboxAtual(undefined);
      return;
    }

    function applyRowIndexHighlight(): boolean {
      if (
        (fallbackMode !== "row-index" && fallbackMode !== "text-then-row-index") ||
        indiceLinha == null ||
        indiceLinha <= 0
      ) {
        return false;
      }
      const isPage1 = paginaInicial === 1;
      const yStart = isPage1 ? 0.35 : 0.15;
      const rowHeight = 0.04;
      const y = Math.min(0.95, yStart + (indiceLinha - 1) * rowHeight);
      setBboxAtual({ x: 0.02, y, w: 0.96, h: rowHeight });
      setHighlightModeAtual("estimada");
      return true;
    }

    const semTexto =
      textError || paginas.length === 0 || paginas.every((p) => p.itens.length === 0);

    if (semTexto) {
      if (!applyRowIndexHighlight()) {
        setHighlightModeAtual("none");
        setBboxAtual(undefined);
      }
      return;
    }

    if (fallbackMode === "row-index") {
      if (!applyRowIndexHighlight()) {
        setHighlightModeAtual("none");
        setBboxAtual(undefined);
      }
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = localizarLinhaPdf({
        paginas,
        dataMovimento,
        valor,
        descricaoRaw,
        remetenteDestinatario,
        documento,
        hora,
        relaxarDataNaLinha,
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

      if (!applyRowIndexHighlight()) {
        setHighlightModeAtual("none");
        setBboxAtual(undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    bboxProp,
    textLoading,
    textError,
    paginas,
    dataMovimento,
    valor,
    descricaoRaw,
    indiceLinha,
    paginaInicial,
    fallbackMode,
    remetenteDestinatario,
    documento,
    hora,
    relaxarDataNaLinha,
    ancoragem,
  ]);

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

  useEffect(() => {
    if (renderLoading || !showHighlight || !bboxAtual || !wrapRef.current || !canvasRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const canvasEl = canvasRef.current;
      const wrapEl = wrapRef.current;
      if (!canvasEl || !wrapEl) return;

      const canvasWidth = canvasEl.clientWidth || canvasEl.width;
      const canvasHeight = canvasEl.clientHeight || canvasEl.height;

      const top = bboxAtual.y * canvasHeight - (wrapEl.clientHeight / 2) + (bboxAtual.h * canvasHeight / 2);
      const left = bboxAtual.x * canvasWidth - (wrapEl.clientWidth / 2) + (bboxAtual.w * canvasWidth / 2);

      wrapEl.scrollTo({
        top,
        left,
        behavior: "smooth",
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [renderLoading, showHighlight, bboxAtual, paginaAtual]);

  const highlightClass =
    destaqueOrigem?.bbox != null
      ? "border-2 border-amber-500 bg-amber-400/30"
      : highlightModeAtual === "estimada"
        ? "border-2 border-blue-500 border-dashed bg-blue-400/15"
        : "border-2 border-amber-500 bg-amber-400/20";

  const loading = renderLoading || textLoading;
  const error = renderError ?? textError;

  const scrollClass = fillHeight
    ? "relative min-h-0 flex-1 overflow-auto bg-slate-100/80"
    : "relative max-h-[60vh] overflow-auto rounded-md border border-slate-100 bg-slate-50/50 p-2";

  return (
    <div
      className={`flex min-h-0 flex-col ${fillHeight ? "h-full gap-1" : "gap-3"} ${
        compact ? "" : "rounded-lg border border-slate-200 bg-background p-3"
      }`}
    >
      {!compact && (
        <div>
          <p className="text-sm font-medium">
            {papel ? `${papel} · ` : ""}
            {nomeArquivo}
          </p>
          {indiceLinha != null && (
            <p className="text-xs text-muted">Linha {indiceLinha}</p>
          )}
        </div>
      )}

      {loading && <p className="shrink-0 text-xs text-muted">Carregando…</p>}
      {error && <p className="shrink-0 text-xs text-red-600">{error}</p>}

      <div className="flex shrink-0 items-center justify-between gap-1 text-xs text-muted">
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-slate-200 disabled:opacity-40"
          disabled={paginaAtual <= 1}
          onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
          aria-label="Página anterior"
        >
          ‹
        </button>
        <span className="min-w-0 truncate">
          {paginaAtual}/{totalPaginas}
          {highlightModeAtual !== "none" && (
            <span
              className={
                highlightModeAtual === "extracao"
                  ? "ml-1 text-emerald-700"
                  : "ml-1 text-blue-700"
              }
            >
              · {legendaHighlight(highlightModeAtual)}
              {highlightModeAtual === "estimada" && indiceLinha != null
                ? ` (linha ${indiceLinha})`
                : ""}
            </span>
          )}
          {compact && paginaAtual !== paginaOrigem && (
            <button
              type="button"
              className="ml-2 text-blue-700 underline"
              onClick={() => setPaginaAtual(paginaOrigem)}
            >
              voltar
            </button>
          )}
        </span>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-slate-200 disabled:opacity-40"
          disabled={pageCount > 0 ? paginaAtual >= pageCount : false}
          onClick={() => setPaginaAtual((p) => (pageCount > 0 ? Math.min(pageCount, p + 1) : p + 1))}
          aria-label="Próxima página"
        >
          ›
        </button>
      </div>

      <div ref={wrapRef} className={scrollClass}>
        <div
          className={`relative mx-auto w-fit ${fillHeight ? "py-2" : "overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg"}`}
        >
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

      {!compact && paginaAtual !== paginaOrigem && (
        <div className="shrink-0">
          <Button
            type="button"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setPaginaAtual(paginaOrigem)}
          >
            Voltar à origem
          </Button>
        </div>
      )}
    </div>
  );
}
