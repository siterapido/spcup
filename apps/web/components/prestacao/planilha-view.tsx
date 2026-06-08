"use client";

import type { PlanilhaPayload } from "@spc-up/core";

export function PlanilhaView({
  sessaoId,
  initial,
}: {
  sessaoId: string;
  initial: PlanilhaPayload;
}) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Planilha — {sessaoId}</h1>
      <pre className="overflow-auto rounded-md bg-muted p-4 text-xs">
        {JSON.stringify(initial.resumo, null, 2)}
      </pre>
    </div>
  );
}
