"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { OrigemEnriquecimentoV1, OrigemExtracaoV1 } from "@spc-up/core/browser";

import { OrigensPanel } from "@/components/prestacao/origens-panel";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";

interface Detalhe {
  id: string;
  sessaoPrestacaoId: string;
  valor: string;
  dataMovimento: string;
  direcao: string;
  status: string;
  confiancaGlobal: number;
  bloqueioExport: boolean;
  descricaoRaw: string;
  credDev: string | null;
  lacunas: string[];
  justificativaIa: string | null;
  iaIndisponivel: boolean;
  nomeArquivo: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  origemEnriquecimento: OrigemEnriquecimentoV1 | null;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  pessoaResumo: string | null;
}

interface PessoaItem {
  id: string;
  tipo: string;
  documento_mascarado: string;
  nome: string;
}

function confiancaTone(v: number): "success" | "warn" | "danger" {
  if (v >= 0.85) return "success";
  if (v >= 0.6) return "warn";
  return "danger";
}

export function ReviewDrawer({
  movimentacaoId,
  sessaoId,
  open,
  onClose,
  onUpdated,
  readOnly = false,
  planilhaHref,
}: {
  movimentacaoId: string | null;
  sessaoId?: string;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  readOnly?: boolean;
  planilhaHref?: string;
}) {
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pessoaQ, setPessoaQ] = useState("");
  const [pessoas, setPessoas] = useState<PessoaItem[]>([]);
  const [busy, setBusy] = useState(false);

  const retorno = `/prestacao/${sessaoId ?? ""}/kanban`;

  const load = useCallback(async () => {
    if (!movimentacaoId) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/movimentacoes/${movimentacaoId}`);
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao carregar detalhe");
        setDetalhe(null);
        return;
      }
      setDetalhe((json.item ?? json) as Detalhe);
    } catch {
      setMessage("Erro de rede.");
      setDetalhe(null);
    } finally {
      setLoading(false);
    }
  }, [movimentacaoId]);

  useEffect(() => {
    if (open && movimentacaoId) void load();
  }, [open, movimentacaoId, load]);

  useEffect(() => {
    if (readOnly || !open || pessoaQ.trim().length < 2) {
      setPessoas([]);
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/pessoas?q=${encodeURIComponent(pessoaQ.trim())}`)
        .then((r) => r.json())
        .then((json) => setPessoas(json.items ?? []))
        .catch(() => setPessoas([]));
    }, 300);
    return () => clearTimeout(t);
  }, [pessoaQ, open, readOnly]);

  async function patchStatus(status: string) {
    if (!movimentacaoId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/movimentacoes/${movimentacaoId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Não foi possível alterar status");
        return;
      }
      onUpdated();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne() {
    if (!movimentacaoId) return;
    if (
      !window.confirm(
        "Excluir esta movimentação?\n\nO registro sai da lista, mas permanece no histórico.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/movimentacoes/${movimentacaoId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao excluir");
        return;
      }
      onUpdated();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const canDelete =
    detalhe != null &&
    ["RASCUNHO", "PENDENTE_REVISAO", "REJEITADO"].includes(detalhe.status);

  async function confirmOne() {
    if (!movimentacaoId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/movimentacoes/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [movimentacaoId] }),
      });
      const json = await res.json();
      if (json.blocked?.length) {
        setMessage("Movimentação bloqueada para exportação — não confirmada.");
      } else if (json.erros?.length) {
        setMessage(json.erros.join("; "));
      }
      onUpdated();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function assignPessoa(body: Record<string, string | boolean>) {
    if (!movimentacaoId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/movimentacoes/${movimentacaoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao vincular");
        return;
      }
      setDetalhe((json.item ?? json) as Detalhe);
      setPessoaQ("");
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  async function reprocessarIa() {
    if (!movimentacaoId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/movimentacoes/${movimentacaoId}/reprocessar-ia`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "IA indisponível");
        return;
      }
      setDetalhe((json.item ?? json) as Detalhe);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const planilhaLinkSessaoId = sessaoId ?? detalhe?.sessaoPrestacaoId;
  const planilhaLink =
    planilhaHref ??
    (planilhaLinkSessaoId ? `/prestacao/${planilhaLinkSessaoId}/planilha` : null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/30"
        aria-label="Fechar"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-border-default bg-white shadow-lg">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <h2 className="text-sm font-semibold">{readOnly ? "Detalhe" : "Revisão"}</h2>
          <button type="button" className="text-sm underline" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-muted">Carregando…</p>}
          {message && <p className="mb-3 text-sm text-red-700">{message}</p>}

          {detalhe && (
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium">
                  R$ {detalhe.valor} · {detalhe.dataMovimento}
                </p>
                <p className="text-muted">{detalhe.direcao}</p>
                {detalhe.nomeArquivo && (
                  <p className="mt-1 text-xs text-muted">Arquivo: {detalhe.nomeArquivo}</p>
                )}
                <p className="mt-2 whitespace-pre-wrap">{detalhe.descricaoRaw}</p>
                {detalhe.credDev ? (
                  <p className="mt-1 text-xs text-muted">Cred dev: {detalhe.credDev}</p>
                ) : null}
              </div>

              <p>
                <Badge tone={confiancaTone(detalhe.confiancaGlobal)}>
                  {Math.round(detalhe.confiancaGlobal * 100)}% confiança
                </Badge>{" "}
                <Badge tone="warn">{detalhe.status}</Badge>
              </p>

              {detalhe.iaIndisponivel && <Badge tone="danger">IA indisponível</Badge>}
              {detalhe.justificativaIa && (
                <p className="text-xs text-muted">{detalhe.justificativaIa}</p>
              )}

              {detalhe.lacunas.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detalhe.lacunas.map((l) => (
                    <Badge key={l} tone="warn">
                      {l}
                    </Badge>
                  ))}
                </div>
              )}

              {detalhe.bloqueioExport && (
                <p className="text-xs text-red-800">
                  Exportação bloqueada — complete campos SPCA e vínculo de pessoa.
                </p>
              )}

              <OrigensPanel
                origemExtracao={detalhe.origemExtracao}
                origemEnriquecimento={detalhe.origemEnriquecimento}
              />

              <div>
                <p className="font-medium">Pessoa</p>
                {detalhe.pessoaResumo ? (
                  <p className="mt-1">{detalhe.pessoaResumo}</p>
                ) : (
                  <p className="mt-1 text-muted">Sem vínculo</p>
                )}
                {!readOnly && (
                  <>
                    <input
                      type="search"
                      placeholder="Buscar por nome ou documento…"
                      className="mt-2 w-full rounded-md border border-border-default px-3 py-2 text-sm"
                      value={pessoaQ}
                      onChange={(e) => setPessoaQ(e.target.value)}
                    />
                    {pessoas.length > 0 && (
                      <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border-default">
                        {pessoas.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
                              disabled={busy}
                              onClick={() =>
                                void assignPessoa(
                                  p.tipo === "PF"
                                    ? { pessoaFisicaId: p.id }
                                    : { pessoaJuridicaId: p.id },
                                )
                              }
                            >
                              {p.nome} · {p.documento_mascarado} ({p.tipo})
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        href={`/pessoas/nova?retorno=${encodeURIComponent(retorno)}`}
                        className="text-xs underline"
                      >
                        Cadastrar nova pessoa
                      </Link>
                      {(detalhe.pessoaFisicaId || detalhe.pessoaJuridicaId) && (
                        <button
                          type="button"
                          className="text-xs underline text-muted"
                          disabled={busy}
                          onClick={() => void assignPessoa({ limparPessoa: true })}
                        >
                          Limpar vínculo
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  {detalhe.status === "PENDENTE_REVISAO" && (
                    <Button type="button" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => void confirmOne()}>
                      Confirmar
                    </Button>
                  )}
                  {detalhe.status !== "REJEITADO" && (
                    <Button
                      type="button"
                      className="px-3 py-1.5 text-xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void patchStatus("REJEITADO")}
                    >
                      Rejeitar
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="px-3 py-1.5 text-xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void reprocessarIa()}
                  >
                    Reprocessar IA
                  </Button>
                  {canDelete && (
                    <Button
                      type="button"
                      className="px-3 py-1.5 text-xs"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => void deleteOne()}
                    >
                      Excluir
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {readOnly && planilhaLink && (
          <div className="border-t border-border-default px-4 py-3">
            <Link href={planilhaLink} className={buttonClassName("default", "w-full")}>
              Abrir na planilha
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}
