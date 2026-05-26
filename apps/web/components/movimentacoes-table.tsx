"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

interface MovItem {
  id: string;
  data_movimento: string;
  direcao: string;
  valor: string;
  descricao_raw: string;
  status: string;
  confianca_global: number;
  pessoa_nome: string | null;
}

export function MovimentacoesTable({
  initialUf,
  initialExercicio,
}: {
  initialUf: string;
  initialExercicio: number;
}) {
  const [uf, setUf] = useState(initialUf);
  const [exercicio, setExercicio] = useState(String(initialExercicio));
  const [items, setItems] = useState<MovItem[]>([]);
  const [exportavel, setExportavel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        uf: uf.toUpperCase(),
        exercicio,
      });
      const res = await fetch(`/api/movimentacoes?${params}`);
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar");
        return;
      }
      setItems(json.items ?? []);
      setExportavel(!!json.exportavel);
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [uf, exercicio]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmOne(id: string) {
    const res = await fetch("/api/movimentacoes/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [id] }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Falha ao confirmar");
      return;
    }
    await load();
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
          />
        </label>
        <label className="text-sm">
          Exercício
          <Input
            type="number"
            value={exercicio}
            onChange={(e) => setExercicio(e.target.value)}
            className="mt-1 w-28"
          />
        </label>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Atualizar
        </Button>
        <Badge tone={exportavel ? "success" : "danger"}>
          Exportação {exportavel ? "liberada" : "bloqueada"}
        </Badge>
      </div>

      {message ? <p className="text-sm text-red-600">{message}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <Table>
          <thead>
            <tr>
              <Th>Data</Th>
              <Th>Direção</Th>
              <Th>Valor</Th>
              <Th>Descrição</Th>
              <Th>Pessoa</Th>
              <Th>Score</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr
                key={m.id}
                className={m.confianca_global < 0.85 ? "bg-amber-50" : undefined}
              >
                <Td>{m.data_movimento}</Td>
                <Td>{m.direcao}</Td>
                <Td>{m.valor}</Td>
                <Td className="max-w-xs truncate" title={m.descricao_raw}>
                  {m.descricao_raw}
                </Td>
                <Td>{m.pessoa_nome ?? "—"}</Td>
                <Td>{m.confianca_global.toFixed(2)}</Td>
                <Td>{m.status}</Td>
                <Td>
                  {m.status !== "CONFIRMADO" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void confirmOne(m.id)}
                    >
                      Confirmar
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {!items.length && !loading ? (
          <p className="p-4 text-sm text-slate-500">Nenhuma movimentação encontrada.</p>
        ) : null}
      </div>
    </div>
  );
}
