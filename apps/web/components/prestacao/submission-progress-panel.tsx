"use client";

import type {
  ErrorLogEntry,
  FileErrorDisplay,
  IngestProgressState,
  PaginaVerificarItem,
  SubmitStep,
  SubmitStepId,
} from "@/hooks/use-prestacao-submit";
import { Button } from "@/components/ui/button";

const SUBMIT_STEP_SHORT_LABELS: Record<SubmitStepId, string> = {
  session: "Sessão",
  upload: "Upload",
  ingest: "Ingestão",
  consolidacao: "Extratos",
  kanban: "Movimentações",
};

function submitStepLabel(step: SubmitStep): string {
  return SUBMIT_STEP_SHORT_LABELS[step.id] ?? step.label;
}

function StepIcon({ status }: { status: SubmitStep["status"] }) {
  if (status === "done") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"
        aria-hidden
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6l2.5 2.5 4.5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white"
        aria-hidden
      >
        !
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        aria-hidden
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-up-black/20 border-t-up-black" />
      </span>
    );
  }
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-default bg-white"
      aria-hidden
    />
  );
}

export type SubmissionProgressPanelProps = {
  progress: number;
  statusLabel: string;
  steps: SubmitStep[];
  fileNames: string[];
  ingestProgress?: IngestProgressState | null;
  fileErrors?: FileErrorDisplay[];
  errorLogs?: ErrorLogEntry[];
  paginasVerificar?: PaginaVerificarItem[];
  onReviewPagina?: (item: PaginaVerificarItem) => void;
  onContinueAfterVerificar?: () => void;
  continueLabel?: string;
  onCancel?: () => void;
};

function PaginasVerificarBanner({
  items,
  onReviewPagina,
  onContinue,
  continueLabel,
}: {
  items: PaginaVerificarItem[];
  onReviewPagina?: (item: PaginaVerificarItem) => void;
  onContinue?: () => void;
  continueLabel?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3"
      role="status"
      aria-label="Páginas para verificar"
    >
      <p className="text-sm font-medium text-amber-950">
        {items.length === 1
          ? "1 página precisa de verificação"
          : `${items.length} páginas precisam de verificação`}
      </p>
      <p className="mt-1 text-xs text-amber-900/90">
        A extração continuou, mas algumas páginas ficaram com linhas incertas. Revise antes
        de seguir para a lista de movimentações.
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={`${item.arquivoId}-${item.pagina}`} className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-amber-950">
              {item.nomeArquivo} · p.{item.pagina}/{item.totalPaginas}
              {item.incertas.length > 0
                ? ` · ${item.incertas.length} incerta${item.incertas.length === 1 ? "" : "s"}`
                : ""}
            </span>
            {onReviewPagina ? (
              <Button
                type="button"
                variant="outline"
                className="h-7 border-amber-400 bg-white px-2 text-xs"
                onClick={() => onReviewPagina(item)}
              >
                Revisar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {onContinue ? (
        <Button type="button" className="mt-3 h-8 px-3 text-sm" onClick={onContinue}>
          {continueLabel ?? "Continuar para movimentações"}
        </Button>
      ) : null}
    </div>
  );
}

function IngestProgressBlock({ ingest }: { ingest: IngestProgressState }) {
  const clamped = Math.min(100, Math.max(0, ingest.percent));
  const recent = ingest.completed.slice(-5);

  return (
    <div
      className="mt-3 rounded-md border border-up-black/15 bg-white p-3"
      aria-labelledby="ingest-progress-title"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p
          id="ingest-progress-title"
          className="text-xs font-medium uppercase tracking-wide text-muted"
        >
          Processar movimentações
        </p>
        <span className="tabular-nums text-xs font-medium text-up-black">
          {clamped}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progresso da ingestão"
        className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width] duration-300 ease-out-quart"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className="text-sm font-medium text-up-black" aria-live="polite">
        {ingest.current}
      </p>
      {ingest.movimentacoesTotal > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {ingest.movimentacoesTotal} movimentação
          {ingest.movimentacoesTotal === 1 ? "" : "ões"} até agora
        </p>
      ) : null}
      {recent.length > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-border-default pt-2">
          {recent.map((line) => (
            <li
              key={line}
              className="flex items-start gap-1.5 text-xs text-up-black/80"
            >
              <span className="mt-0.5 text-emerald-600" aria-hidden>
                ✓
              </span>
              <span className="min-w-0 break-words">{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileErrorCard({ item }: { item: FileErrorDisplay }) {
  return (
    <li className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.nome}</span>
        <span className="rounded bg-red-200/80 px-1.5 py-0.5 font-mono text-xs text-red-950">
          {item.codigo}
        </span>
      </div>
      <p className="mt-1 text-red-800">{item.mensagem}</p>
      {item.causaTecnica && item.causaTecnica !== item.mensagem ? (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs font-medium text-red-900">
            Detalhes técnicos
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-red-200 bg-white p-2 font-mono text-xs text-red-950">
            {item.causaTecnica}
          </pre>
        </details>
      ) : null}
    </li>
  );
}

function ErrorLogList({ logs }: { logs: ErrorLogEntry[] }) {
  if (logs.length === 0) return null;
  return (
    <div className="mt-3 border-t border-border-default pt-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        Log do processamento
      </p>
      <ol className="space-y-2">
        {logs.map((entry, index) => (
          <li
            key={`${entry.etapa}-${index}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <p className="font-medium text-up-black">{entry.etapa}</p>
            <p className="text-red-800">{entry.mensagem}</p>
            {entry.detalhe ? (
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700">
                {entry.detalhe}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SubmissionProgressPanel({
  progress,
  statusLabel,
  steps,
  fileNames,
  ingestProgress = null,
  fileErrors = [],
  errorLogs = [],
  paginasVerificar = [],
  onReviewPagina,
  onContinueAfterVerificar,
  continueLabel,
  onCancel,
}: SubmissionProgressPanelProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const hasErrors = fileErrors.length > 0 || errorLogs.length > 0;
  const ingestStep = steps.find((s) => s.id === "ingest");
  const showIngestBlock =
    ingestProgress != null &&
    (ingestStep?.status === "active" || ingestStep?.status === "done");

  return (
    <div
      className="rounded-md border border-border-default bg-slate-50/80 p-4"
      aria-busy={progress < 100}
    >
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted">
          <span>Progresso</span>
          <div className="flex items-center gap-2">
            {onCancel ? (
              <Button
                type="button"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={onCancel}
              >
                Cancelar
              </Button>
            ) : null}
            <span className="tabular-nums font-medium text-up-black">{clamped}%</span>
          </div>
        </div>
        <div
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da prestação"
          className="h-2 overflow-hidden rounded-full bg-slate-200"
        >
          <div
            className="h-full rounded-full bg-up-black transition-[width] duration-300 ease-out-quart"
            style={{ width: `${clamped}%` }}
          />
        </div>
        <p
          className={`mt-2 text-sm ${hasErrors ? "text-red-800" : "text-up-black"}`}
          aria-live="polite"
        >
          {statusLabel}
        </p>
      </div>

      <ol className="flex flex-col gap-3 border-t border-border-default pt-3 sm:flex-row sm:gap-2 sm:pb-1">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex min-w-0 flex-1 flex-col items-center text-center sm:min-w-[5.5rem]"
          >
            <div className="flex w-full items-center">
              {index > 0 ? (
                <span
                  className={`hidden h-px flex-1 sm:block ${
                    step.status === "pending" ? "bg-border-default" : "bg-up-black/25"
                  }`}
                  aria-hidden
                />
              ) : (
                <span className="hidden flex-1 sm:block" aria-hidden />
              )}
              <StepIcon status={step.status} />
              {index < steps.length - 1 ? (
                <span
                  className={`hidden h-px flex-1 sm:block ${
                    step.status === "done" || step.status === "error"
                      ? "bg-up-black/25"
                      : "bg-border-default"
                  }`}
                  aria-hidden
                />
              ) : (
                <span className="hidden flex-1 sm:block" aria-hidden />
              )}
            </div>
            <span
              className={`mt-1.5 text-xs leading-tight sm:line-clamp-2 ${
                step.status === "active"
                  ? "font-medium text-up-black"
                  : step.status === "done"
                    ? "text-up-black/80"
                    : step.status === "error"
                      ? "text-red-800"
                      : "text-muted"
              }`}
            >
              <span className="sm:hidden">{submitStepLabel(step)}</span>
              <span className="hidden sm:inline">{step.label}</span>
            </span>
          </li>
        ))}
      </ol>

      {showIngestBlock ? <IngestProgressBlock ingest={ingestProgress} /> : null}

      <PaginasVerificarBanner
        items={paginasVerificar}
        onReviewPagina={onReviewPagina}
        onContinue={onContinueAfterVerificar}
        continueLabel={continueLabel}
      />

      {fileNames.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border-default pt-3">
          {fileNames.map((name) => (
            <span
              key={name}
              className="max-w-full truncate rounded-md border border-border-default bg-white px-2 py-0.5 text-xs text-up-black/90"
              title={name}
            >
              {name}
            </span>
          ))}
        </div>
      ) : null}

      {fileErrors.length > 0 ? (
        <ul
          className="mt-3 space-y-2 border-t border-border-default pt-3"
          role="alert"
          aria-label="Erros no processamento"
        >
          {fileErrors.map((item) => (
            <FileErrorCard key={item.nome} item={item} />
          ))}
        </ul>
      ) : null}

      <ErrorLogList logs={errorLogs} />
    </div>
  );
}
