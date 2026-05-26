"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

interface PessoaItem {
  id: string;
  tipo: "PF" | "PJ";
  documento_mascarado: string;
  nome: string;
  movimentacoes_count: number;
}

export function PessoasTable() {
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [items, setItems] = useState<PessoaItem[]>([]);
  const [loading, setLoading] = useState(false);
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
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [q, tipo]);

  useEffect(() => {
    void load();
  }, [load]);

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
            className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="">Todos</option>
            <option value="PF">PF</option>
            <option value="PJ">PJ</option>
          </select>
        </label>
        <Button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Carregando…" : "Buscar"}
        </Button>
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}

      <Table>
        <thead>
          <tr>
            <Th>Tipo</Th>
            <Th>Documento</Th>
            <Th>Nome</Th>
            <Th>Movimentações</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.tipo}-${item.id}`}>
              <Td>
                <Badge tone={item.tipo === "PF" ? "neutral" : "warn"}>
                  {item.tipo}
                </Badge>
              </Td>
              <Td>{item.documento_mascarado}</Td>
              <Td>{item.nome}</Td>
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
          ))}
        </tbody>
      </Table>
      {items.length === 0 && !loading ? (
        <p className="text-sm text-slate-500">Nenhum cadastro encontrado.</p>
      ) : null}
    </div>
  );
}
