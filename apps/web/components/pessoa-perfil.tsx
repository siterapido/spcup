"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";

interface PerfilProps {
  id: string;
  tipo: "pf" | "pj";
}

export function PessoaPerfil({ id, tipo }: PerfilProps) {
  const [perfil, setPerfil] = useState<{
    nome: string;
    documento_mascarado: string;
    tipo: string;
  } | null>(null);
  const [resumo, setResumo] = useState<{
    total: number;
    byUf: Record<string, number>;
    byExercicio: Record<number, number>;
  } | null>(null);
  const [items, setItems] = useState<
    Array<{
      id: string;
      uf: string;
      exercicio: number;
      data_movimento: string;
      direcao: string;
      valor: string;
      status: string;
    }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage(null);
    try {
      const [perfilRes, movRes] = await Promise.all([
        fetch(`/api/pessoas/${id}?tipo=${tipo}`),
        fetch(`/api/pessoas/${id}/movimentacoes?tipo=${tipo}`),
      ]);
      const perfilJson = await perfilRes.json();
      const movJson = await movRes.json();
      if (!perfilRes.ok) {
        setMessage(perfilJson.error ?? "Erro ao carregar perfil");
        return;
      }
      if (!movRes.ok) {
        setMessage(movJson.error ?? "Erro ao carregar histórico");
        return;
      }
      setPerfil(perfilJson);
      setResumo(movJson.resumo);
      setItems(movJson.items ?? []);
    } catch {
      setMessage("Erro de rede.");
    }
  }, [id, tipo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (message) {
    return <p className="text-sm text-red-600">{message}</p>;
  }

  if (!perfil) {
    return <p className="text-sm text-slate-500">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Badge tone="neutral">{perfil.tipo}</Badge>
        <h2 className="mt-2 text-xl font-semibold">{perfil.nome}</h2>
        <p className="text-sm text-slate-600">{perfil.documento_mascarado}</p>
        {resumo ? (
          <p className="mt-2 text-sm">
            {resumo.total} movimentação(ões) ·{" "}
            {Object.keys(resumo.byUf).length} UF(s) ·{" "}
            {Object.keys(resumo.byExercicio).length} exercício(s)
          </p>
        ) : null}
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Data</Th>
            <Th>UF</Th>
            <Th>Exercício</Th>
            <Th>Direção</Th>
            <Th>Valor</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {items.map((mov) => (
            <tr key={mov.id}>
              <Td>{mov.data_movimento}</Td>
              <Td>{mov.uf}</Td>
              <Td>{mov.exercicio}</Td>
              <Td>{mov.direcao}</Td>
              <Td>{mov.valor}</Td>
              <Td>{mov.status}</Td>
              <Td>
                <Link
                  href={`/movimentacoes?uf=${mov.uf}&exercicio=${mov.exercicio}`}
                  className="text-sm underline"
                >
                  Ver lote
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Sem movimentações vinculadas.</p>
      ) : null}
    </div>
  );
}
