"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";

import { PdfOrigemPainel } from "@/components/prestacao/pdf-origem-painel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { selecionarOrigensPixCompleto } from "@/lib/pdf-comparador-origens";

import type { PlanilhaLinha, PlanilhaOrigem } from "@spc-up/core";

function confiancaTone(v: number): "success" | "warn" | "danger" {
  if (v >= 0.85) return "success";
  if (v >= 0.6) return "warn";
  return "danger";
}

type PdfComparadorModalProps = {
  open: boolean;
  onClose: () => void;
  linha: PlanilhaLinha;
  sessaoId: string;
  onMergeResolved: () => void;
};

function origemDisponivel(origem: PlanilhaOrigem | null): origem is PlanilhaOrigem {
  return origem != null && Boolean(origem.arquivoIngestaoId);
}

function painelProps(
  origem: PlanilhaOrigem,
  linha: PlanilhaLinha,
): ComponentProps<typeof PdfOrigemPainel> {
  const ext = origem.origemExtracao;
  const bbox = origem.bbox ?? ext?.bbox;
  const paginaInicial = origem.pagina ?? ext?.pagina ?? 1;

  return {
    arquivoIngestaoId: origem.arquivoIngestaoId!,
    nomeArquivo: origem.nomeArquivo ?? "extrato.pdf",
    papel: origem.papel,
    paginaInicial,
    bbox,
    highlightMode: bbox ? "extracao" : "none",
    indiceLinha: origem.indiceLinha ?? ext?.indiceLinha,
    dataMovimento: linha.dataMovimento,
    valor: linha.valor,
    descricaoRaw: origem.descricaoRaw || linha.descricaoRaw,
  };
}

function PainelLado({
  titulo,
  origem,
  linha,
}: {
  titulo: string;
  origem: PlanilhaOrigem | null;
  linha: PlanilhaLinha;
}) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="shrink-0 border-b border-slate-100 px-3 py-2 text-sm font-medium text-slate-800">
        {titulo}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {origemDisponivel(origem) ? (
          <PdfOrigemPainel {...painelProps(origem, linha)} />
        ) : (
          <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-muted">
            Origem não disponível
          </div>
        )}
      </div>
    </div>
  );
}

export function PdfComparadorModal({
  open,
  onClose,
  linha,
  sessaoId,
  onMergeResolved,
}: PdfComparadorModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSeparar, setConfirmSeparar] = useState(false);

  const { pix, completo } = selecionarOrigensPixCompleto(linha.origens);

  const resolveMerge = useCallback(
    async (acao: "confirmar" | "separar") => {
      setBusy(true);
      try {
        const res = await fetch(
          `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linha.id}/merge`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ acao, fonte: linha.fonte }),
          },
        );
        if (res.ok) {
          onMergeResolved();
          onClose();
        }
      } finally {
        setBusy(false);
        setConfirmSeparar(false);
      }
    },
    [sessaoId, linha.id, linha.fonte, onMergeResolved, onClose],
  );

  useEffect(() => {
    if (!open) {
      setConfirmSeparar(false);
      return;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmSeparar) {
          setConfirmSeparar(false);
        } else {
          onClose();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, confirmSeparar]);

  if (!open) {
    return null;
  }

  const pessoaLabel = linha.pessoa
    ? `${linha.pessoa.tipo} · ${linha.pessoa.nome}`
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/50"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-comparador-titulo"
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-surface-card outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-slate-200 px-4 py-3">
          <h2 id="pdf-comparador-titulo" className="sr-only">
            Comparar PDFs
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{linha.dataMovimento}</span>
            <span>·</span>
            <span>R$ {linha.valor}</span>
            <span>·</span>
            <span>{linha.direcao}</span>
            <Badge tone={confiancaTone(linha.confianca)}>
              {Math.round(linha.confianca * 100)}%
            </Badge>
            <span>·</span>
            <span>{pessoaLabel}</span>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-muted md:grid-cols-2">
            <p className="truncate" title={pix?.descricaoRaw ?? linha.descricaoRaw}>
              <span className="font-medium text-slate-700">PIX:</span>{" "}
              {pix?.descricaoRaw ?? "—"}
            </p>
            <p className="truncate" title={completo?.descricaoRaw ?? linha.descricaoRaw}>
              <span className="font-medium text-slate-700">COMPLETO:</span>{" "}
              {completo?.descricaoRaw ?? "—"}
            </p>
          </div>
        </header>

        <div
          className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 md:grid-cols-2"
          style={{ maxHeight: "calc(100vh - 8rem)" }}
        >
          <PainelLado
            titulo={
              pix
                ? `PIX · ${pix.nomeArquivo ?? "extrato.pdf"}`
                : "PIX"
            }
            origem={pix}
            linha={linha}
          />
          <PainelLado
            titulo={
              completo
                ? `COMPLETO · ${completo.nomeArquivo ?? "extrato.pdf"}`
                : "COMPLETO"
            }
            origem={completo}
            linha={linha}
          />
        </div>

        <footer className="shrink-0 border-t border-slate-200 px-4 py-3">
          {confirmSeparar ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="flex-1 text-sm text-slate-800">
                Isso criará 2 linhas separadas. Continuar?
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmSeparar(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void resolveMerge("separar")}
              >
                Confirmar
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {linha.status === "merge_pendente" && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() => void resolveMerge("confirmar")}
                  >
                    Confirmar merge
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmSeparar(true)}
                  >
                    Manter separado
                  </Button>
                </>
              )}
              <Button variant="ghost" disabled={busy} onClick={onClose}>
                Fechar
              </Button>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
