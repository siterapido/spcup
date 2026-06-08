"use client";

import { useEffect, useState } from "react";

import { loadPdfJs } from "@/lib/pdfjs-browser";

/** Aligned with packages/core/src/pdf-locate/types.ts (Subagent 1). */
export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPaginaTexto = {
  pagina: number;
  itens: PdfTextItem[];
};

type UsePdfTextLayerResult = {
  paginas: PdfPaginaTexto[];
  pageCount: number;
  loading: boolean;
  error: string | null;
};

async function loadTextLayer(arquivoIngestaoId: string): Promise<{
  paginas: PdfPaginaTexto[];
  pageCount: number;
}> {
  const pdfjs = await loadPdfJs();
  const res = await fetch(`/api/arquivos-ingestao/${arquivoIngestaoId}/pdf`);
  if (!res.ok) {
    throw new Error("Não foi possível carregar o PDF");
  }
  const data = await res.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = doc.numPages;
  const paginas: PdfPaginaTexto[] = [];

  for (let pagina = 1; pagina <= pageCount; pagina++) {
    const page = await doc.getPage(pagina);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const itens: PdfTextItem[] = [];

    for (const raw of textContent.items) {
      if (!("str" in raw) || typeof raw.str !== "string" || raw.str.length === 0) {
        continue;
      }
      const tx = raw.transform;
      const fontHeight = Math.hypot(tx[2] ?? 0, tx[3] ?? 0) || raw.height;
      const x = (tx[4] ?? 0) / viewport.width;
      const y = (viewport.height - (tx[5] ?? 0) - fontHeight) / viewport.height;
      const width = raw.width / viewport.width;
      const height = fontHeight / viewport.height;

      itens.push({
        str: raw.str,
        x: clamp01(x),
        y: clamp01(y),
        width: clamp01(width),
        height: clamp01(height),
      });
    }

    paginas.push({ pagina, itens });
  }

  return { paginas, pageCount };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function usePdfTextLayer(
  arquivoIngestaoId: string | null,
  enabled: boolean,
): UsePdfTextLayerResult {
  const [paginas, setPaginas] = useState<PdfPaginaTexto[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !arquivoIngestaoId) {
      setPaginas([]);
      setPageCount(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const result = await loadTextLayer(arquivoIngestaoId!);
        if (!cancelled) {
          setPaginas(result.paginas);
          setPageCount(result.pageCount);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao extrair texto do PDF");
          setPaginas([]);
          setPageCount(0);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [arquivoIngestaoId, enabled]);

  return { paginas, pageCount, loading, error };
}
