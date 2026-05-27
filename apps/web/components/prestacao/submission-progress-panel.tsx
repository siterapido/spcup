"use client";

import type {
  ErrorLogEntry,
  FileErrorDisplay,
  SubmitStep,
} from "@/hooks/use-prestacao-submit";

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
  fileErrors?: FileErrorDisplay[];
  errorLogs?: ErrorLogEntry[];
};

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
  fileErrors = [],
  errorLogs = [],
}: SubmissionProgressPanelProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const hasErrors = fileErrors.length > 0 || errorLogs.length > 0;

  return (
    <div
      className="rounded-md border border-border-default bg-slate-50/80 p-4"
      aria-busy={progress < 100}
    >
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted">
          <span>Progresso</span>
          <span className="tabular-nums font-medium text-up-black">{clamped}%</span>
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

      <ol className="space-y-2 border-t border-border-default pt-3">
        {steps.map((step) => (
          <li key={step.id} className="flex items-center gap-2.5 text-sm">
            <StepIcon status={step.status} />
            <span
              className={
                step.status === "active"
                  ? "font-medium text-up-black"
                  : step.status === "done"
                    ? "text-up-black/80"
                    : step.status === "error"
                      ? "text-red-800"
                      : "text-muted"
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>

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
