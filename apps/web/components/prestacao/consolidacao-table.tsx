"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { OrigemAtributosEvento } from "@spc-up/core";

import { OrigensPanel } from "@/components/prestacao/origens-panel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export type ConsolidacaoEventoRow = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  linhas: Array<{
    id: string;
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nomeArquivo: string | null;
  }>;
  hipoteses: Array<{
    id: string;
    tipo: string;
    confianca: number;
    payload: unknown;
  }>;
  origemAtributos: OrigemAtributosEvento | null;
};

type Props = {
  sessaoId: string;
  eventos: ConsolidacaoEventoRow[];
  cadastroAlerta: boolean;
};

export function ConsolidacaoTable({ sessaoId, eventos, cadastroAlerta }: Props) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pendentes = eventos.filter((e) => e.status === "PENDENTE");

  const act = useCallback(
    async (eventoId: string, action: "aprovar" | "rejeitar") => {
      setBusyId(eventoId);
      setMessage(null);
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${eventoId}/${action}`,
        { method: "POST" },
      );
      setBusyId(null);
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setMessage(json.error ?? "Erro na operação");
        return;
      }
      router.refresh();
    },
    [router, sessaoId],
  );

  async function aprovarLote() {
    setMessage(null);
    const res = await fetch(
      `/api/prestacao/sessoes/${sessaoId}/consolidacao/aprovar-lote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minConfianca: 0.85 }),
      },
    );
    const json = (await res.json()) as { aprovados?: number; erros?: string[] };
    if (!res.ok) {
      setMessage("Erro no lote");
      return;
    }
    setMessage(`${json.aprovados ?? 0} evento(s) aprovado(s).`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {cadastroAlerta && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Cadastro da UF parece vazio para match por nome (PIX). Importe em{" "}
          <Link href="/pessoas" className="font-medium underline">
            Cadastro
          </Link>{" "}
          antes de aprovar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void aprovarLote()}>
          Aprovar ≥85% com pessoa
        </Button>
        <Link
          href={`/prestacao/${sessaoId}/kanban`}
          className={buttonClassName("outline")}
        >
          Ir ao kanban
        </Link>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}

      {pendentes.length === 0 ? (
        <p className="text-sm text-muted">Nenhum evento pendente. Continue no kanban.</p>
      ) : (
        <div className="space-y-2">
          {pendentes.map((ev) => {
            const pct = Math.round(ev.confianca * 100);
            const expanded = expandedId === ev.id;
            return (
              <Card key={ev.id} className="p-4">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-4 text-left"
                  onClick={() => setExpandedId(expanded ? null : ev.id)}
                >
                  <div>
                    <p className="font-medium">
                      {ev.dataMovimento} · R$ {ev.valor} · {ev.direcao}
                    </p>
                    <p className="text-sm text-muted">{ev.justificativa}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ev.linhas.map((l) => (
                        <Badge key={l.id} tone="neutral">
                          {l.papel}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{pct}%</p>
                    <p className="text-xs text-muted">confiança</p>
                  </div>
                </button>

                {expanded && (
                  <div className="mt-4 space-y-3 border-t border-border-default pt-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      {ev.linhas.map((l) => (
                        <div key={l.id} className="rounded-md bg-muted/30 p-3 text-sm">
                          <p className="font-medium">{l.nomeArquivo ?? l.papel}</p>
                          <p className="mt-1 whitespace-pre-wrap">{l.descricaoRaw}</p>
                        </div>
                      ))}
                    </div>
                    <OrigensPanel origemAtributos={ev.origemAtributos} />
                    {ev.hipoteses.length > 0 && (
                      <div>
                        <p className="text-sm font-medium">Outras hipóteses</p>
                        <ul className="mt-1 list-inside list-disc text-sm text-muted">
                          {ev.hipoteses.map((h) => (
                            <li key={h.id}>
                              {h.tipo} ({Math.round(h.confianca * 100)}%)
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        className="px-3 py-1.5 text-xs"
                        disabled={busyId === ev.id}
                        onClick={() => void act(ev.id, "aprovar")}
                      >
                        Aprovar
                      </Button>
                      <Button
                        type="button"
                        className="px-3 py-1.5 text-xs"
                        variant="outline"
                        disabled={busyId === ev.id}
                        onClick={() => void act(ev.id, "rejeitar")}
                      >
                        Rejeitar
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConsolidacaoPageHeader({ sessaoId }: { sessaoId: string }) {
  return (
    <>
      <CardTitle>Consolidação de extratos</CardTitle>
      <p className="mt-1 text-sm text-muted">
        Revise movimentações entre extratos e vínculo com cadastro antes do kanban.
      </p>
      <p className="text-xs text-muted">Sessão {sessaoId}</p>
    </>
  );
}
