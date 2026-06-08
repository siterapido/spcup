"use client";

import { useState } from "react";

import { Button, buttonClassName } from "@/components/ui/button";
import { maskCnpj } from "@/lib/mask-document";

type Prestador = { cnpj: string; nome: string | null };

type Props = {
  uf: string;
  mes: string;
  prestadores: Prestador[];
  exercicio: number;
};

function downloadUrl(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function MovimentacoesExportMenu({ uf, mes, prestadores, exercicio }: Props) {
  const [zipModalOpen, setZipModalOpen] = useState(false);
  const [selectedCnpj, setSelectedCnpj] = useState<string | null>(null);

  const ufParam = uf.toUpperCase();

  function exportLista(formato: "csv" | "xlsx") {
    const qs = new URLSearchParams({ uf: ufParam, mes, formato });
    downloadUrl(`/api/movimentacoes/export?${qs}`);
  }

  function exportEspelho() {
    const qs = new URLSearchParams({ uf: ufParam, mes });
    downloadUrl(`/api/movimentacoes/export/spca-espelho?${qs}`);
  }

  function exportZip(cnpj: string) {
    const qs = new URLSearchParams({
      uf: ufParam,
      exercicio: String(exercicio),
      cnpj_prestador: cnpj,
    });
    downloadUrl(`/api/movimentacoes/export/spca-zip?${qs}`);
  }

  function handleZipClick() {
    if (prestadores.length === 0) return;
    if (prestadores.length === 1) {
      exportZip(prestadores[0].cnpj);
      return;
    }
    setSelectedCnpj(prestadores[0]?.cnpj ?? null);
    setZipModalOpen(true);
  }

  function confirmZip() {
    if (!selectedCnpj) return;
    exportZip(selectedCnpj);
    setZipModalOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={() => exportLista("csv")}>
          Exportar CSV
        </Button>
        <Button type="button" variant="outline" onClick={() => exportLista("xlsx")}>
          Exportar XLSX
        </Button>

        <details className="relative">
          <summary
            className={`${buttonClassName("outline")} cursor-pointer list-none marker:content-none`}
          >
            SPCA ▾
          </summary>
          <div className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-md border border-border-default bg-white py-1 shadow-md">
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => exportEspelho()}
            >
              Espelho (mês)
            </button>
            <button
              type="button"
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={prestadores.length === 0}
              onClick={() => handleZipClick()}
            >
              Pacote ZIP
            </button>
          </div>
        </details>
      </div>

      {zipModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className="w-full max-w-md rounded-lg border border-border-default bg-background p-4 shadow-lg"
            role="dialog"
            aria-labelledby="spca-zip-title"
          >
            <h2 id="spca-zip-title" className="font-medium text-up-black">
              Pacote ZIP SPCA
            </h2>
            <p className="mt-2 text-sm text-muted">
              Pacote oficial ignora filtro de mês; inclui todas as movimentações
              confirmadas/exportadas do prestador no exercício.
            </p>
            <fieldset className="mt-4 space-y-2">
              <legend className="text-sm font-medium">Prestador</legend>
              {prestadores.map((p) => (
                <label
                  key={p.cnpj}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border-default px-3 py-2 text-sm hover:bg-slate-50"
                >
                  <input
                    type="radio"
                    name="spca-zip-prestador"
                    value={p.cnpj}
                    checked={selectedCnpj === p.cnpj}
                    onChange={() => setSelectedCnpj(p.cnpj)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium">{p.nome ?? "—"}</span>
                    <span className="text-muted">{maskCnpj(p.cnpj)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setZipModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={!selectedCnpj} onClick={() => confirmZip()}>
                Baixar pacote
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
