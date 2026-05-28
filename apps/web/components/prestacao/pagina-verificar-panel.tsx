"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import type { IncertaPreview } from "@/hooks/use-prestacao-submit";

export type PaginaVerificarPanelProps = {
  sessaoId: string;
  arquivoId: string;
  pagina: number;
  nomeArquivo: string;
  incertas: IncertaPreview[];
  onIgnorar: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onClose: () => void;
};

function formatPreviewValue(valor: unknown): string {
  if (valor == null) return "—";
  if (typeof valor === "number" || typeof valor === "string") return String(valor);
  return JSON.stringify(valor);
}

export function PaginaVerificarPanel({
  sessaoId,
  arquivoId,
  pagina,
  nomeArquivo,
  incertas,
  onIgnorar,
  onRetry,
  onClose,
}: PaginaVerificarPanelProps) {
  const [busy, setBusy] = useState<"ignorar" | "retry" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const imagemUrl = `/api/prestacao/sessoes/${sessaoId}/arquivos/${arquivoId}/paginas/${pagina}/imagem`;

  const runAction = useCallback(
    async (kind: "ignorar" | "retry", fn: () => void | Promise<void>) => {
      setBusy(kind);
      setActionError(null);
      try {
        await fn();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Erro ao processar ação.");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-border-default bg-background shadow-lg"
        role="dialog"
        aria-labelledby="pagina-verificar-title"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-default px-4 py-3">
          <div className="min-w-0">
            <h2 id="pagina-verificar-title" className="font-medium text-up-black">
              Página para verificar
            </h2>
            <p className="truncate text-sm text-muted">
              {nomeArquivo} · página {pagina}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto p-4 lg:grid-cols-2">
          <div className="min-h-0">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Preview da página
            </p>
            <div className="overflow-hidden rounded-md border border-border-default bg-slate-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagemUrl}
                alt={`Página ${pagina} de ${nomeArquivo}`}
                className="mx-auto block max-h-[50vh] w-full object-contain"
              />
            </div>
          </div>

          <div className="min-h-0">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
              Linhas incertas ({incertas.length})
            </p>
            {incertas.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Nenhuma linha incerta listada — revise a imagem e escolha ignorar ou tentar
                novamente.
              </p>
            ) : (
              <ul className="max-h-[50vh] space-y-2 overflow-auto">
                {incertas.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border-default bg-white px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{item.id.slice(0, 8)}</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-950">
                        score {item.score}
                      </span>
                    </div>
                    <p className="mt-1 text-up-black">{item.motivo}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-up-black/80">
                      {item.preview.data ? (
                        <>
                          <dt className="text-muted">Data</dt>
                          <dd>{item.preview.data}</dd>
                        </>
                      ) : null}
                      {item.preview.valor != null ? (
                        <>
                          <dt className="text-muted">Valor</dt>
                          <dd>{formatPreviewValue(item.preview.valor)}</dd>
                        </>
                      ) : null}
                      {item.preview.direcao ? (
                        <>
                          <dt className="text-muted">Direção</dt>
                          <dd>{item.preview.direcao}</dd>
                        </>
                      ) : null}
                      {item.preview.nome ? (
                        <>
                          <dt className="text-muted">Nome</dt>
                          <dd className="col-span-1 break-words">{item.preview.nome}</dd>
                        </>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {actionError ? (
          <p className="px-4 text-sm text-red-700" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border-default px-4 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={busy != null}
            onClick={() => void runAction("ignorar", onIgnorar)}
          >
            {busy === "ignorar" ? "Ignorando…" : "Ignorar página"}
          </Button>
          <Button
            type="button"
            disabled={busy != null}
            onClick={() => void runAction("retry", onRetry)}
          >
            {busy === "retry" ? "Reprocessando…" : "Tentar novamente"}
          </Button>
        </div>
      </div>
    </div>
  );
}
