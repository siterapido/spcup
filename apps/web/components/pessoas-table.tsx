"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th } from "@/components/ui/table";

interface PessoaItem {
  id: string;
  tipo: "PF" | "PJ";
  documento_mascarado: string;
  nome: string;
  estado: string | null;
  movimentacoes_count: number;
}

function pessoaKey(item: Pick<PessoaItem, "id" | "tipo">) {
  return `${item.tipo}:${item.id}`;
}

export function PessoasTable() {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [items, setItems] = useState<PessoaItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (tipo) params.set("tipo", tipo);
      const res = await fetch(`/api/pessoas?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar");
        return;
      }
      setItems(json.items ?? []);
      setSelected(new Set());
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [q, tipo]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleKeys = useMemo(() => items.map((item) => pessoaKey(item)), [items]);
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((key) => selected.has(key));
  const someVisibleSelected =
    visibleKeys.some((key) => selected.has(key)) && !allVisibleSelected;

  function toggleRow(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (!checked) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const key of visibleKeys) next.delete(key);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const key of visibleKeys) next.add(key);
      return next;
    });
  }

  async function deleteSelected() {
    const keys = [...selected];
    if (keys.length === 0) return;

    const toDelete = keys
      .map((key) => {
        const item = items.find((row) => pessoaKey(row) === key);
        if (!item) return null;
        return { id: item.id, tipo: item.tipo };
      })
      .filter((item): item is { id: string; tipo: PessoaItem["tipo"] } => item !== null);

    if (toDelete.length === 0) return;

    const label =
      toDelete.length === 1
        ? "Excluir 1 cadastro selecionado?"
        : `Excluir ${toDelete.length} cadastros selecionados?`;
    if (!window.confirm(`${label}\n\nEsta ação não pode ser desfeita.`)) return;

    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pessoas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: toDelete }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao excluir");
        return;
      }

      const skipped = (json.skipped ?? []) as Array<{ reason: string }>;
      const deleted = json.deleted ?? 0;
      let msg = `${deleted} excluída(s).`;
      if (skipped.length > 0) {
        msg += ` ${skipped.length} não excluída(s) (vínculos ou não encontradas).`;
      }
      setMessage(msg);
      setSelected(new Set());
      await load();
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Busca
          <Input
            className="mt-1 w-56"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nome ou documento"
          />
        </label>
        <label className="text-sm">
          Tipo
          <select
            className="mt-1 block w-full max-w-[8rem] rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm text-up-black focus:border-up-black focus:outline-none focus:ring-1 focus:ring-up-black"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="PF">PF</option>
            <option value="PJ">PJ</option>
          </select>
        </label>
        <Button type="button" onClick={() => void load()} disabled={loading || deleting}>
          {loading ? "Carregando…" : "Buscar"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={selected.size === 0 || deleting || loading}
          onClick={() => void deleteSelected()}
        >
          {deleting ? "Excluindo…" : `Excluir selecionados (${selected.size})`}
        </Button>
      </div>

      {message ? (
        <p className={`text-sm ${message.includes("Erro") ? "text-red-600" : "text-muted"}`}>
          {message}
        </p>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th className="w-10">
              <input
                type="checkbox"
                aria-label="Selecionar todos na página"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                disabled={items.length === 0 || loading || deleting}
                onChange={(e) => toggleSelectAll(e.target.checked)}
              />
            </Th>
            <Th>Tipo</Th>
            <Th>Documento</Th>
            <Th>Nome</Th>
            <Th>Estado</Th>
            <Th>Movimentações</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = pessoaKey(item);
            return (
              <tr key={key}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${item.nome}`}
                    checked={selected.has(key)}
                    disabled={loading || deleting}
                    onChange={(e) => toggleRow(key, e.target.checked)}
                  />
                </Td>
                <Td>
                  <Badge tone={item.tipo === "PF" ? "neutral" : "warn"}>
                    {item.tipo}
                  </Badge>
                </Td>
                <Td>{item.documento_mascarado}</Td>
                <Td>{item.nome}</Td>
                <Td>{item.estado ?? "—"}</Td>
                <Td>{item.movimentacoes_count}</Td>
                <Td>
                  <Link
                    href={`/pessoas/${item.id}?tipo=${item.tipo.toLowerCase()}`}
                    className="text-sm underline"
                  >
                    Perfil
                  </Link>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {items.length === 0 && !loading ? (
        <EmptyState
          title="Nenhum cadastro encontrado"
          description="Ajuste a busca ou cadastre uma nova pessoa."
        />
      ) : null}
    </div>
  );
}
