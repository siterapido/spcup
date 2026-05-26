"use client";

import { useCallback, useEffect, useState } from "react";

import { ReviewDrawer } from "@/components/prestacao/review-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface KanbanCard {
  id: string;
  valor: string;
  dataMovimento: string;
  direcao: string;
  status: string;
  confiancaGlobal: number;
  bloqueioExport: boolean;
  descricaoRaw: string;
  lacunas: string[];
  justificativaIa: string | null;
  iaIndisponivel: boolean;
  pessoaResumo: string | null;
}

interface KanbanPayload {
  sessao: {
    id: string;
    uf: string;
    tipoPrestador: string;
    exercicio: number;
    prestadorNome: string;
    cnpjPrestador: string;
  };
  exportavel: boolean;
  arquivos: Array<{
    id: string;
    nomeArquivo: string;
    status: string;
    movimentacoes: KanbanCard[];
  }>;
}

const COLUMNS = [
  { key: "RASCUNHO", label: "Rascunho" },
  { key: "PENDENTE_REVISAO", label: "Revisão" },
  { key: "CONFIRMADO", label: "Confirmado" },
  { key: "EXPORTADO", label: "Exportado" },
  { key: "REJEITADO", label: "Rejeitado" },
] as const;

function confiancaTone(v: number): "success" | "warn" | "danger" {
  if (v >= 0.85) return "success";
  if (v >= 0.6) return "warn";
  return "danger";
}

export function KanbanBoard({ sessaoId }: { sessaoId: string }) {
  const [data, setData] = useState<KanbanPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prestacao/sessoes/${sessaoId}/movimentacoes`);
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar");
        return;
      }
      setData(json);
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }, [sessaoId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmSelected() {
    const ids = [...selected];
    const res = await fetch("/api/movimentacoes/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Erro ao confirmar");
      return;
    }
    setSelected(new Set());
    const blocked = (json.blocked ?? []) as string[];
    const confirmadas = json.confirmadas ?? 0;
    let msg = `${confirmadas} confirmada(s).`;
    if (blocked.length > 0) {
      msg += ` ${blocked.length} bloqueada(s) para exportação.`;
    }
    if (json.erros?.length) {
      msg += ` ${json.erros.join("; ")}`;
    }
    setMessage(msg);
    await load();
  }

  if (loading) {
    return <p className="text-sm text-muted">Carregando kanban…</p>;
  }

  if (!data) {
    return <p className="text-sm text-red-700">{message ?? "Sessão não encontrada"}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prestação de contas</h1>
        <p className="mt-1 text-sm text-muted">
          {data.sessao.uf} · {data.sessao.tipoPrestador} · {data.sessao.prestadorNome} ·
          Exercício {data.sessao.exercicio}
        </p>
        <p className="mt-2">
          Exportação SPCA:{" "}
          <Badge tone={data.exportavel ? "success" : "danger"}>
            {data.exportavel ? "liberada" : "bloqueada"}
          </Badge>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={selected.size === 0}
          onClick={() => void confirmSelected()}
        >
          Confirmar selecionados ({selected.size})
        </Button>
        <Button
          type="button"
          disabled={!data.exportavel}
          onClick={() => {
            window.location.href = `/api/prestacao/sessoes/${sessaoId}/export`;
          }}
        >
          Exportar pacote SPCA
        </Button>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((col) => (
          <div key={col.key} className="min-w-[220px] flex-1">
            <h2 className="mb-2 text-sm font-medium text-up-black">{col.label}</h2>
            <div className="space-y-4">
              {data.arquivos.map((arq) => {
                const cards = arq.movimentacoes.filter((m) => m.status === col.key);
                if (cards.length === 0) return null;
                return (
                  <div key={`${col.key}-${arq.id}`}>
                    <p className="mb-1 truncate text-xs font-medium text-muted">
                      {arq.nomeArquivo}
                    </p>
                    <div className="space-y-2">
                      {cards.map((card) => (
                        <Card
                          key={card.id}
                          className="cursor-pointer p-3 transition-colors hover:bg-slate-50"
                          onClick={() => setDrawerId(card.id)}
                        >
                          <div className="flex items-start gap-2">
                            {col.key === "PENDENTE_REVISAO" && (
                              <input
                                type="checkbox"
                                className="mt-1"
                                checked={selected.has(card.id)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(card.id);
                                  else next.delete(card.id);
                                  setSelected(next);
                                }}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">
                                R$ {card.valor} · {card.dataMovimento}
                              </p>
                              <p className="text-xs text-muted">{card.direcao}</p>
                              {card.pessoaResumo && (
                                <p className="mt-1 text-xs">{card.pessoaResumo}</p>
                              )}
                              <p className="mt-1">
                                <Badge tone={confiancaTone(card.confiancaGlobal)}>
                                  {Math.round(card.confiancaGlobal * 100)}%
                                </Badge>
                              </p>
                              {card.lacunas.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {card.lacunas.slice(0, 2).map((l) => (
                                    <Badge key={l} tone="warn">
                                      {l}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ReviewDrawer
        movimentacaoId={drawerId}
        sessaoId={sessaoId}
        open={drawerId != null}
        onClose={() => setDrawerId(null)}
        onUpdated={() => void load()}
      />
    </div>
  );
}
