import Link from "next/link";

import { END_TO_END_FLOW_STEPS } from "@/components/prestacao/prestacao-flow-steps";

export function PrestacaoFlowOverview() {
  return (
    <div>
      <nav aria-label="Pipeline de prestação de contas">
        <ol className="flex items-start justify-between gap-1">
          {END_TO_END_FLOW_STEPS.map((step, index) => (
            <li
              key={step.id}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="flex w-full items-center">
                {index > 0 ? (
                  <span className="h-px flex-1 bg-border-default" aria-hidden />
                ) : (
                  <span className="flex-1" aria-hidden />
                )}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    step.id === 1
                      ? "bg-up-black text-up-white ring-2 ring-up-yellow ring-offset-2"
                      : "border border-border-default bg-white text-muted"
                  }`}
                >
                  {step.id}
                </span>
                {index < END_TO_END_FLOW_STEPS.length - 1 ? (
                  <span className="h-px flex-1 bg-border-default" aria-hidden />
                ) : (
                  <span className="flex-1" aria-hidden />
                )}
              </div>
              <span
                className={`mt-1.5 max-w-full truncate px-0.5 text-center text-xs ${
                  step.id === 1 ? "font-medium text-up-black" : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      <p className="mt-3 text-sm text-muted">
        Configure UF e prestador, anexe extratos/planilhas, revise as movimentações e exporte
        o pacote SPCA quando a exportação estiver liberada.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Link
          href="/prestacao"
          className="inline-flex items-center justify-center rounded-md border border-border-default bg-white px-4 py-2 text-sm font-medium text-up-black hover:bg-slate-50"
        >
          Ver prestações
        </Link>
        <Link
          href="/prestacao/nova"
          className="inline-flex items-center justify-center rounded-md bg-up-black px-4 py-2 text-sm font-medium text-up-white hover:bg-up-black-hover"
        >
          Nova prestação
        </Link>
        <Link
          href="/admin/diretorios-estaduais"
          className="inline-flex items-center justify-center rounded-md border border-border-default bg-white px-4 py-2 text-sm font-medium text-up-black hover:bg-slate-50"
        >
          Diretórios estaduais
        </Link>
        <Link
          href="/admin/diretorios-municipais"
          className="inline-flex items-center justify-center rounded-md border border-border-default bg-white px-4 py-2 text-sm font-medium text-up-black hover:bg-slate-50"
        >
          Diretórios municipais
        </Link>
      </div>
    </div>
  );
}
