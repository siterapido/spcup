"use client";

import { useEffect, useState } from "react";

import type { PlanilhaLinhaFonte } from "@spc-up/core/browser";
import { compararNomeCadastro } from "@spc-up/core/browser";

import { Input } from "@/components/ui/input";

const TOOLTIP_VAZIO =
  "Extração não identificou contraparte — edite ou veja origens";

type Props = {
  sessaoId: string;
  linhaId: string;
  fonte: PlanilhaLinhaFonte;
  remetenteDestinatario: string | null;
  pessoaNome?: string | null;
  disabled?: boolean;
  onUpdated: () => void;
};

function isVazio(value: string): boolean {
  return !value || value.trim().length < 3;
}

export function PlanilhaRemetenteDestinatarioCell({
  sessaoId,
  linhaId,
  fonte,
  remetenteDestinatario,
  pessoaNome,
  disabled,
  onUpdated,
}: Props) {
  const [value, setValue] = useState(remetenteDestinatario ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(remetenteDestinatario ?? "");
  }, [remetenteDestinatario]);

  async function save(next: string) {
    const trimmed = next.trim();
    const current = (remetenteDestinatario ?? "").trim();
    if (trimmed === current) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linhaId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fonte,
            remetenteDestinatario: trimmed.length > 0 ? trimmed : null,
          }),
        },
      );
      if (res.ok) onUpdated();
    } finally {
      setBusy(false);
    }
  }

  const vazio = isVazio(value);
  const title = vazio ? TOOLTIP_VAZIO : value || undefined;
  const comparacao = pessoaNome
    ? compararNomeCadastro(value, pessoaNome)
    : "indefinido";

  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-8 min-w-[10rem] text-xs"
        value={value}
        placeholder="—"
        disabled={disabled || busy}
        title={title}
        aria-label={vazio ? TOOLTIP_VAZIO : undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
      />
      {comparacao !== "indefinido" && (
        <span
          aria-hidden
          title={`extraído: ${value || "—"} / cadastro: ${pessoaNome}`}
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${
            comparacao === "bate" ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
      )}
    </div>
  );
}
