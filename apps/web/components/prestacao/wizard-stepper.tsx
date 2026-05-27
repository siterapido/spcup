"use client";

import { WIZARD_STEPS } from "@/components/prestacao/prestacao-flow-steps";

export type WizardStepperProps = {
  current: number;
  onStepClick?: (step: number) => void;
};

export function WizardStepper({ current, onStepClick }: WizardStepperProps) {
  return (
    <nav aria-label="Etapas da prestação" className="mt-4">
      <ol className="flex items-start justify-between gap-1">
        {WIZARD_STEPS.map((step, index) => {
          const isComplete = step.id < current;
          const isActive = step.id === current;
          const isPending = step.id > current;
          const canNavigate = isComplete && onStepClick;

          return (
            <li
              key={step.id}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="flex w-full items-center">
                {index > 0 ? (
                  <span
                    className={`h-px flex-1 ${
                      isComplete || isActive ? "bg-up-black/30" : "bg-border-default"
                    }`}
                    aria-hidden
                  />
                ) : (
                  <span className="flex-1" aria-hidden />
                )}

                {canNavigate ? (
                  <button
                    type="button"
                    onClick={() => onStepClick(step.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-up-black text-xs font-medium text-up-white transition-colors hover:bg-up-black-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-up-black"
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`${step.label}, concluído. Voltar para esta etapa.`}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden>
                      <path
                        d="M2.5 6l2.5 2.5 4.5-5"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : (
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      isActive
                        ? "bg-up-black text-up-white ring-2 ring-up-yellow ring-offset-2"
                        : isPending
                          ? "border border-border-default bg-white text-muted"
                          : "bg-up-black text-up-white"
                    }`}
                    aria-current={isActive ? "step" : undefined}
                  >
                    {isComplete ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path
                          d="M2.5 6l2.5 2.5 4.5-5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      step.id
                    )}
                  </span>
                )}

                {index < WIZARD_STEPS.length - 1 ? (
                  <span
                    className={`h-px flex-1 ${
                      isComplete ? "bg-up-black/30" : "bg-border-default"
                    }`}
                    aria-hidden
                  />
                ) : (
                  <span className="flex-1" aria-hidden />
                )}
              </div>

              <span
                className={`mt-1.5 max-w-full truncate px-0.5 text-center text-xs ${
                  isActive
                    ? "font-medium text-up-black"
                    : isComplete
                      ? "text-up-black/80"
                      : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
