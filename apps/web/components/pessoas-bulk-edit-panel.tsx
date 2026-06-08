"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

export interface PessoaBulkItem {
  id: string;
  tipo: "PF" | "PJ";
  documento_mascarado: string;
  nome: string;
  titulo_eleitor?: string | null;
}

interface EditableRow {
  id: string;
  tipo: "PF" | "PJ";
  documento_mascarado: string;
  nome: string;
  titulo_eleitor: string;
}

export function PessoasBulkEditPanel({
  items,
  onCancel,
  onSaved,
}: {
  items: PessoaBulkItem[];
  onCancel: () => void;
  onSaved: (message: string) => void;
}) {
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRows(
      items.map((item) => ({
        id: item.id,
        tipo: item.tipo,
        documento_mascarado: item.documento_mascarado,
        nome: item.nome,
        titulo_eleitor: item.titulo_eleitor ?? "",
      })),
    );
    setMessage(null);
  }, [items]);

  function updateRow(index: number, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    const payload = rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      nome: row.nome,
      ...(row.tipo === "PF" ? { tituloEleitor: row.titulo_eleitor.trim() || null } : {}),
    }));

    if (payload.some((item) => !item.nome.trim())) {
      setMessage("Todos os cadastros precisam de nome.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pessoas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao salvar");
        return;
      }

      const updated = json.updated ?? 0;
      const unchanged = json.unchanged ?? 0;
      const skipped = (json.skipped ?? []) as Array<{ reason: string }>;
      let msg = `${updated} atualizada(s).`;
      if (unchanged > 0) msg += ` ${unchanged} sem alteração.`;
      if (skipped.length > 0) {
        msg += ` ${skipped.length} não atualizada(s).`;
      }
      onSaved(msg);
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border border-border-default bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Editar {items.length} cadastro(s) selecionado(s)</h3>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Salvando…" : "Salvar alterações"}
          </Button>
        </div>
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}

      <div className="overflow-x-auto">
        <Table>
          <thead>
            <tr>
              <Th>Tipo</Th>
              <Th>Documento</Th>
              <Th>Nome</Th>
              <Th>Título de eleitor</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.tipo}:${row.id}`}>
                <Td>
                  <Badge tone={row.tipo === "PF" ? "neutral" : "warn"}>{row.tipo}</Badge>
                </Td>
                <Td>{row.documento_mascarado}</Td>
                <Td>
                  <Input
                    value={row.nome}
                    onChange={(e) => updateRow(index, { nome: e.target.value })}
                    disabled={saving}
                  />
                </Td>
                <Td>
                  {row.tipo === "PF" ? (
                    <Input
                      value={row.titulo_eleitor}
                      onChange={(e) => updateRow(index, { titulo_eleitor: e.target.value })}
                      maxLength={12}
                      disabled={saving}
                    />
                  ) : (
                    "—"
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
