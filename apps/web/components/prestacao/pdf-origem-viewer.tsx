"use client";

import { PdfOrigemPainel } from "@/components/prestacao/pdf-origem-painel";
import { Button } from "@/components/ui/button";

import type { BboxNorm } from "@spc-up/core/browser";

type Props = {
  open: boolean;
  onClose: () => void;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
  /** Rótulo do dado em conferência (ex.: "Valor · extrato.pdf"). */
  highlightLabel?: string;
  indiceLinha?: number;
};

export function PdfOrigemViewer({
  open,
  onClose,
  arquivoIngestaoId,
  nomeArquivo,
  pagina,
  bbox,
  highlightLabel,
  indiceLinha,
}: Props) {
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
              {indiceLinha != null ? ` · linha ${indiceLinha}` : ""}
              {bbox ? " · área destacada em amarelo" : " · sem caixa de destaque (reingestão pode incluir bbox)"}
            </p>
            {highlightLabel && (
              <p className="text-xs font-medium text-amber-900 mt-1">{highlightLabel}</p>
            )}
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
        <PdfOrigemPainel
          arquivoIngestaoId={arquivoIngestaoId}
          nomeArquivo={nomeArquivo}
          paginaInicial={pagina}
          bbox={bbox}
          highlightMode={bbox ? "extracao" : "none"}
          indiceLinha={indiceLinha}
          dataMovimento=""
          valor=""
          descricaoRaw=""
        />
      </div>
    </div>
  );
}
