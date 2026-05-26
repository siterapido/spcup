"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, Td, Th } from "@/components/ui/table";

interface ConflitoItem {
  id: string;
  tipo: string;
  documento_mascarado: string;
  nome_existente: string;
  nome_proposto: string;
  origem: string;
  uf_contexto: string;
  exercicio_contexto: number;
}

export function ConflitosTable() {
  const [items, setItems] = useState<ConflitoItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pessoas/conflitos?status=PENDENTE");
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar");
        return;
      }
      setItems(json.items ?? []);
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolver(id: string, resolucao: string) {
    const res = await fetch(`/api/pessoas/conflitos/${id}/resolver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolucao }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Falha ao resolver");
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <Table>
        <thead>
          <tr>
            <Th>Tipo</Th>
            <Th>Documento</Th>
            <Th>Existente</Th>
            <Th>Proposto</Th>
            <Th>Contexto</Th>
            <Th>Ações</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <Td>{item.tipo}</Td>
              <Td>{item.documento_mascarado}</Td>
              <Td>{item.nome_existente}</Td>
              <Td>{item.nome_proposto}</Td>
              <Td>
                {item.uf_contexto === "—" || item.exercicio_contexto === 0
                  ? "—"
                  : `${item.uf_contexto}/${item.exercicio_contexto}`}
              </Td>
              <Td className="space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resolver(item.id, "MANTER_NOME")}
                  disabled={loading}
                >
                  Manter
                </Button>
                <Button
                  type="button"
                  onClick={() => void resolver(item.id, "ATUALIZAR_NOME")}
                  disabled={loading}
                >
                  Atualizar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void resolver(item.id, "IGNORADO")}
                  disabled={loading}
                >
                  Ignorar
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {items.length === 0 && !loading ? (
        <EmptyState
          title="Nenhum conflito pendente"
          description="Divergências de nome na importação ou cadastro aparecem aqui para revisão."
        />
      ) : null}
    </div>
  );
}
