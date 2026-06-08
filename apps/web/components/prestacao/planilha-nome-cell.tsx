"use client";

import { useEffect, useState } from "react";

import type { PlanilhaLinhaFonte } from "@spc-up/core/browser";
import { compararNomeCadastro } from "@spc-up/core/browser";

import { Input } from "@/components/ui/input";

const TOOLTIP_NOME_VAZIO =
  "Extração não identificou contraparte — edite ou veja origens";

type Props = {
  sessaoId: string;
  linhaId: string;
  fonte: PlanilhaLinhaFonte;
  nome: string;
  nomeDerivado?: boolean;
  pessoaNome?: string | null;
  disabled?: boolean;
  onUpdated: () => void;
};

function isNomeVazio(nome: string): boolean {
  return !nome || nome.trim().length < 3;
}

export function PlanilhaNomeCell({
  sessaoId,
  linhaId,
  fonte,
  nome,
  nomeDerivado,
  pessoaNome,
  disabled,
  onUpdated,
}: Props) {
  const [value, setValue] = useState(nome);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(nome);
  }, [nome]);

  async function save(next: string) {
    const trimmed = next.trim();
    if (trimmed === nome.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linhaId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fonte,
            nomeContraparte: trimmed.length > 0 ? trimmed : null,
          }),
        },
      );
      if (res.ok) onUpdated();
    } finally {
      setBusy(false);
    }
  }

  const vazio = isNomeVazio(value);
  const title = vazio ? TOOLTIP_NOME_VAZIO : value || undefined;
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
        aria-label={
          vazio && nomeDerivado
            ? `${TOOLTIP_NOME_VAZIO} (derivado das origens)`
            : undefined
        }
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
