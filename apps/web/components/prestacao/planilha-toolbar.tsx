"use client";

import Link from "next/link";

import type { IngestaoResumo, PlanilhaResumo } from "@spc-up/core/browser";

import { PlanilhaIngestaoResumo } from "@/components/prestacao/planilha-ingestao-resumo";
import { Button } from "@/components/ui/button";

export type PlanilhaFilter =
  | "todos"
  | "prontas"
  | "sem_rd"
  | "sem_pessoa"
  | "baixa_confianca"
  | "merge_pendente"
  | "extracao_duvidosa";

const FILTERS: { id: PlanilhaFilter; label: string; count: (r: PlanilhaResumo) => number }[] = [
  { id: "todos", label: "Todos", count: (r) => r.total },
  { id: "prontas", label: "Prontas", count: (r) => r.prontas },
  { id: "sem_rd", label: "Sem remetente/destinatário", count: (r) => r.semRemetenteDestinatario },
  { id: "sem_pessoa", label: "Sem pessoa", count: (r) => r.semPessoa },
  { id: "baixa_confianca", label: "Baixa confiança", count: (r) => r.baixaConfianca },
  { id: "merge_pendente", label: "Merge pendente", count: (r) => r.mergePendente },
  { id: "extracao_duvidosa", label: "Extração duvidosa", count: (r) => r.extracaoDuvidosa },
];

type Props = {
  resumo: PlanilhaResumo;
  sessaoId: string;
  ingestaoResumo?: IngestaoResumo;
  activeFilter: PlanilhaFilter;
  onFilterChange: (filter: PlanilhaFilter) => void;
  onExportBlockedClick: () => void;
};

export function PlanilhaToolbar({
  resumo,
  sessaoId,
  ingestaoResumo,
  activeFilter,
  onFilterChange,
  onExportBlockedClick,
}: Props) {
  const pct = resumo.total > 0 ? Math.round((resumo.prontas / resumo.total) * 100) : 0;

  return (
    <div className="space-y-4" id="planilha-toolbar">
      {ingestaoResumo ? (
        <PlanilhaIngestaoResumo sessaoId={sessaoId} ingestaoResumo={ingestaoResumo} />
      ) : null}

      {resumo.cadastroAlerta && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Cadastro de pessoas vazio para esta UF.{" "}
          <Link href="/pessoas/importar" className="font-medium underline">
            Importar cadastro
          </Link>{" "}
          para vincular PF/PJ com autocomplete.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium">
            {resumo.prontas}/{resumo.total} prontas para export
          </p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            Para exportar: PF/PJ vinculado · confiança ≥60% · sem merge pendente · sem
            extração duvidosa (remetente/destinatário não é obrigatório)
          </p>
        </div>

        {resumo.exportavel ? (
          <Link
            href={`/prestacao/${sessaoId}/export`}
            className="inline-flex items-center justify-center rounded-md bg-up-black px-4 py-2 text-sm font-medium text-up-white hover:bg-up-black-hover"
          >
            Exportar
          </Link>
        ) : (
          <Button
            type="button"
            className="cursor-pointer opacity-60"
            aria-disabled
            onClick={onExportBlockedClick}
          >
            Exportar
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = activeFilter === f.id;
          const n = f.count(resumo);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilterChange(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-up-black bg-up-black text-white"
                  : "border-border-default bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {f.label}
              {f.id === "prontas" || (f.id !== "todos" && n > 0) ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
