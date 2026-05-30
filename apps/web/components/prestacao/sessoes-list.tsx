"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

type SessaoItem = {
  id: string;
  uf: string;
  tipoPrestador: string;
  exercicio: number;
  status: string;
  cnpjPrestador: string;
  prestadorNome: string;
  consolidarExtratos: boolean;
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  ABERTA: "Aberta",
  EM_PROCESSAMENTO: "Em processamento",
  ENCERRADA: "Encerrada",
};

function statusTone(status: string): "neutral" | "warn" | "success" {
  if (status === "ENCERRADA") return "success";
  if (status === "EM_PROCESSAMENTO") return "warn";
  return "neutral";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function SessoesList({
  initialUf,
  initialExercicio,
}: {
  initialUf: string;
  initialExercicio: number;
}) {
  const [uf, setUf] = useState(initialUf);
  const [exercicio, setExercicio] = useState(String(initialExercicio));
  const [items, setItems] = useState<SessaoItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const allIds = useMemo(() => items.map((s) => s.id), [items]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id)) && !allSelected;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      const ufTrim = uf.trim().toUpperCase();
      if (ufTrim.length === 2) params.set("uf", ufTrim);
      if (exercicio.trim()) params.set("exercicio", exercicio.trim());

      const res = await fetch(`/api/prestacao/sessoes?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar prestações");
        return;
      }
      const next = (json.items ?? []) as SessaoItem[];
      setItems(next);
      setSelected((prev) => {
        const valid = new Set(next.map((s) => s.id));
        const kept = new Set<string>();
        for (const id of prev) {
          if (valid.has(id)) kept.add(id);
        }
        return kept;
      });
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [uf, exercicio]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(allIds) : new Set());
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;

    const label =
      ids.length === 1
        ? "Excluir 1 prestação selecionada?"
        : `Excluir ${ids.length} prestações selecionadas?`;
    if (
      !window.confirm(
        `${label}\n\nA prestação sai da lista e as movimentações vinculadas são ocultadas. Prestações com movimentações já exportadas não podem ser excluídas.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/prestacao/sessoes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao excluir");
        return;
      }

      const skipped = (json.skipped ?? []) as Array<{ id: string; reason: string }>;
      const deleted = json.deleted ?? 0;
      let msg = `${deleted} prestação(ões) excluída(s).`;
      if (skipped.length > 0) {
        const reasons = skipped.map((s) => s.reason).join(" ");
        msg += ` ${skipped.length} não excluída(s): ${reasons}`;
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
          UF
          <Input
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            className="mt-1 w-20"
            placeholder="Todas"
          />
        </label>
        <label className="text-sm">
          Exercício
          <Input
            type="number"
            value={exercicio}
            onChange={(e) => setExercicio(e.target.value)}
            className="mt-1 w-28"
            placeholder="Todos"
          />
        </label>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Atualizar
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={selected.size === 0 || deleting || loading}
          onClick={() => void deleteSelected()}
        >
          {deleting ? "Excluindo…" : `Excluir selecionadas (${selected.size})`}
        </Button>
        <Link
          href="/prestacao/nova"
          className="mb-0.5 inline-flex items-center justify-center rounded-md bg-up-black px-4 py-2 text-sm font-medium text-up-white hover:bg-up-black-hover"
        >
          Nova prestação
        </Link>
      </div>

      {message ? <p className="text-sm text-muted">{message}</p> : null}

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : null}

      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma prestação encontrada com os filtros atuais.{" "}
          <Link href="/prestacao/nova" className="font-medium text-up-black underline">
            Iniciar nova prestação
          </Link>
        </p>
      ) : null}

      {items.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th className="w-10">
                <input
                  type="checkbox"
                  className="rounded border-border-input"
                  title="Selecionar todas"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={deleting}
                />
              </Th>
              <Th>Criada em</Th>
              <Th>Prestador</Th>
              <Th>UF</Th>
              <Th>Exercício</Th>
              <Th>Tipo</Th>
              <Th>Status</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-border-default">
                <Td>
                  <input
                    type="checkbox"
                    className="rounded border-border-input"
                    checked={selected.has(s.id)}
                    onChange={(e) => toggleOne(s.id, e.target.checked)}
                    disabled={deleting}
                    aria-label={`Selecionar prestação ${s.prestadorNome || s.id}`}
                  />
                </Td>
                <Td className="whitespace-nowrap text-sm">{formatDate(s.createdAt)}</Td>
                <Td>
                  <div className="font-medium">{s.prestadorNome || "—"}</div>
                  <div className="text-xs text-muted">{s.cnpjPrestador}</div>
                </Td>
                <Td>{s.uf}</Td>
                <Td>{s.exercicio}</Td>
                <Td>{s.tipoPrestador === "MUNICIPAL" ? "Municipal" : "Estadual"}</Td>
                <Td>
                  <Badge tone={statusTone(s.status)}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                </Td>
                <Td className="text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link
                      href={`/prestacao/${s.id}/kanban`}
                      className="text-sm font-medium text-up-black underline"
                    >
                      Movimentações
                    </Link>
                    {s.consolidarExtratos ? (
                      <Link
                        href={`/prestacao/${s.id}/consolidacao`}
                        className="text-sm font-medium text-up-black underline"
                      >
                        Consolidação
                      </Link>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </div>
  );
}
