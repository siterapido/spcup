"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";

interface PerfilProps {
  id: string;
  tipo: "pf" | "pj";
}

export function PessoaPerfil({ id, tipo }: PerfilProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [perfil, setPerfil] = useState<{
    nome: string;
    documento_mascarado: string;
    tipo: string;
    titulo_eleitor?: string | null;
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

  async function excluir() {
    if (
      !window.confirm(
        "Excluir este cadastro?\n\nO cadastro some das listas, mas o histórico de movimentações permanece.",
      )
    ) {
      return;
    }

    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/pessoas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ id, tipo: tipo.toUpperCase() }],
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao excluir");
        return;
      }
      const skipped = (json.skipped ?? []) as Array<{ reason: string }>;
      if (skipped.length > 0) {
        setMessage(skipped[0]?.reason ?? "Não foi possível excluir");
        return;
      }
      router.push("/pessoas");
      router.refresh();
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setDeleting(false);
    }
  }

  if (message) {
    return <p className="text-sm text-red-600">{message}</p>;
  }

  if (!perfil) {
    return <p className="text-sm text-muted">Carregando…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Badge tone="neutral">{perfil.tipo}</Badge>
        <h2 className="mt-2 text-xl font-semibold">{perfil.nome}</h2>
        <p className="text-sm text-muted">{perfil.documento_mascarado}</p>
        {tipo === "pf" && perfil.titulo_eleitor ? (
          <p className="text-sm text-muted">Título de eleitor: {perfil.titulo_eleitor}</p>
        ) : null}
        {resumo ? (
          <p className="mt-2 text-sm">
            {resumo.total} movimentação(ões) ·{" "}
            {Object.keys(resumo.byUf).length} UF(s) ·{" "}
            {Object.keys(resumo.byExercicio).length} exercício(s)
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/pessoas/${id}/editar?tipo=${tipo}`}>
            <Button type="button" variant="outline">
              Editar
            </Button>
          </Link>
          <Button
            type="button"
            variant="destructive"
            disabled={deleting}
            onClick={() => void excluir()}
          >
            {deleting ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
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
                  href={`/movimentacoes?uf=${mov.uf}&mes=${String(mov.data_movimento).slice(0, 7)}`}
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
        <p className="text-sm text-muted">Sem movimentações vinculadas.</p>
      ) : null}
    </div>
  );
}
