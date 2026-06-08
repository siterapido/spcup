"use client";

import { useEffect, useState } from "react";

import type { PlanilhaLinhaFonte, PlanilhaPessoa } from "@spc-up/core";

import { Input } from "@/components/ui/input";
import { maskDocumento } from "@/lib/mask-document";

type PessoaItem = {
  id: string;
  tipo: string;
  documento_mascarado: string;
  nome: string;
};

type Props = {
  sessaoId: string;
  linhaId: string;
  fonte: PlanilhaLinhaFonte;
  pessoa: PlanilhaPessoa | null;
  onUpdated: () => void;
  disabled?: boolean;
};

export function PlanilhaPessoaCell({
  sessaoId,
  linhaId,
  fonte,
  pessoa,
  onUpdated,
  disabled = false,
}: Props) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PessoaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setItems([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/pessoas?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((json) => setItems(json.items ?? []))
        .catch(() => setItems([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function patch(body: Record<string, string | boolean>) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linhaId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fonte, ...body }),
        },
      );
      if (!res.ok) return;
      setQ("");
      setOpen(false);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  if (pessoa && !open) {
    return (
      <div className="min-w-[10rem]">
        <button
          type="button"
          className="text-left text-xs hover:underline disabled:opacity-50"
          disabled={disabled || busy}
          onClick={() => setOpen(true)}
        >
          <span className="font-medium">{pessoa.nome}</span>
          <br />
          <span className="text-muted">
            {maskDocumento(pessoa.tipo, pessoa.documento)} ({pessoa.tipo})
          </span>
        </button>
        <button
          type="button"
          className="ml-2 text-xs text-muted underline"
          disabled={disabled || busy}
          onClick={() => void patch({ limparPessoa: true })}
        >
          Limpar
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-w-[10rem]">
      <Input
        type="search"
        placeholder="Buscar pessoa…"
        className="h-8 text-xs"
        value={q}
        disabled={disabled || busy}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-36 w-full overflow-y-auto rounded-md border border-border-default bg-white shadow-md">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                disabled={busy}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  void patch(
                    p.tipo === "PF"
                      ? { pessoaFisicaId: p.id }
                      : { pessoaJuridicaId: p.id },
                  )
                }
              >
                {p.nome} · {p.documento_mascarado} ({p.tipo})
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
