"use client";

import type { OrigemEnriquecimentoV1, OrigemExtracaoV1 } from "@spc-up/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ReviewDrawer } from "@/components/prestacao/review-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface MovimentacaoRow {
  id: string;
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
  pessoaResumo: string | null;
  nomeArquivo: string | null;
  origemExtracao: OrigemExtracaoV1 | null;
  origemEnriquecimento: OrigemEnriquecimentoV1 | null;
}

interface SessaoPayload {
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
    movimentacoes: MovimentacaoRow[];
  }>;
}

const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  PENDENTE_REVISAO: "Revisão",
  CONFIRMADO: "Confirmado",
  EXPORTADO: "Exportado",
  REJEITADO: "Rejeitado",
};

function confiancaTone(v: number): "success" | "warn" | "danger" {
  if (v >= 0.85) return "success";
  if (v >= 0.6) return "warn";
  return "danger";
}

function formatOrigemPdf(origem: OrigemExtracaoV1 | null): string {
  if (!origem) return "—";
  const base = `${origem.nomeArquivo} · pág. ${origem.pagina} · linha ${origem.indiceLinha}`;
  if (!origem.dual) return base;
  const consenso = origem.dual.consenso ? "consenso" : "divergente";
  return `${base} · IA ${consenso} (${Math.round(origem.dual.score * 100)}%)`;
}

function formatEnriquecimento(origem: OrigemEnriquecimentoV1 | null): string {
  if (!origem?.refs?.length) return "—";
  return origem.refs
    .map((ref) => {
      switch (ref.tipo) {
        case "PDF":
          return `PDF p.${ref.pagina} L${ref.indiceLinha}`;
        case "CADASTRO_UF":
          return `Cadastro ${ref.matchTipo}`;
        case "CRUZAMENTO_PDF":
          return `Cruzamento ${ref.regra}`;
        case "IA_CRUZAMENTO":
          return ref.detalhe ?? "IA";
        case "INDISPONIVEL":
          return ref.motivo;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join(" · ");
}

export function MovimentacoesList({ sessaoId }: { sessaoId: string }) {
  const [data, setData] = useState<SessaoPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const flat: MovimentacaoRow[] = [];
    for (const arq of data.arquivos) {
      for (const mov of arq.movimentacoes) {
        flat.push({
          ...mov,
          nomeArquivo: mov.nomeArquivo ?? arq.nomeArquivo,
        });
      }
    }
    return flat.sort((a, b) => {
      const d = a.dataMovimento.localeCompare(b.dataMovimento);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
  }, [data]);

  const revisaoIds = useMemo(
    () => rows.filter((r) => r.status === "PENDENTE_REVISAO").map((r) => r.id),
    [rows],
  );

  const allRevisaoSelected =
    revisaoIds.length > 0 && revisaoIds.every((id) => selected.has(id));
  const someRevisaoSelected =
    revisaoIds.some((id) => selected.has(id)) && !allRevisaoSelected;

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

  function toggleRevisaoSelection(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllRevisao(checked: boolean) {
    if (!checked) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of revisaoIds) next.delete(id);
        return next;
      });
      return;
    }
    setSelected((prev) => new Set([...prev, ...revisaoIds]));
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;

    const label =
      ids.length === 1
        ? "Excluir 1 movimentação selecionada?"
        : `Excluir ${ids.length} movimentações selecionadas?`;
    if (
      !window.confirm(
        `${label}\n\nOs registros saem da lista, mas permanecem no histórico.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/movimentacoes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Erro ao excluir");
        return;
      }

      const skipped = (json.skipped ?? []) as Array<{ reason: string }>;
      const deleted = json.deleted ?? 0;
      let msg = `${deleted} excluída(s).`;
      if (skipped.length > 0) {
        msg += ` ${skipped.length} não excluída(s) (status ou já removidas).`;
      }
      setMessage(msg);
      setSelected(new Set());
      if (drawerId && ids.includes(drawerId)) {
        setDrawerId(null);
      }
      await load();
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Carregando movimentações…</p>;
  }

  if (!data) {
    return <p className="text-sm text-red-700">{message ?? "Sessão não encontrada"}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Movimentações extraídas</h1>
        <p className="mt-1 text-sm text-muted">
          {data.sessao.uf} · {data.sessao.tipoPrestador} · {data.sessao.prestadorNome} ·
          Exercício {data.sessao.exercicio} · {rows.length} registro(s)
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
          disabled={selected.size === 0 || deleting}
          onClick={() => void confirmSelected()}
        >
          Confirmar selecionados ({selected.size})
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={selected.size === 0 || deleting}
          onClick={() => void deleteSelected()}
        >
          {deleting ? "Excluindo…" : `Excluir selecionados (${selected.size})`}
        </Button>
        <Button
          type="button"
          disabled={!data.exportavel || deleting}
          onClick={() => {
            window.location.href = `/api/prestacao/sessoes/${sessaoId}/export`;
          }}
        >
          Exportar pacote SPCA
        </Button>
      </div>

      {message && <p className="text-sm text-muted">{message}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma movimentação nesta sessão.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="border-b border-border-default bg-slate-50 text-xs font-medium text-muted">
              <tr>
                <th className="px-2 py-2 w-8">
                  {revisaoIds.length > 0 && (
                    <input
                      type="checkbox"
                      className="rounded border-border-input"
                      title="Selecionar todas em revisão"
                      checked={allRevisaoSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someRevisaoSelected;
                      }}
                      onChange={(e) => toggleAllRevisao(e.target.checked)}
                    />
                  )}
                </th>
                <th className="px-3 py-2">Data</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Direção</th>
                <th className="px-3 py-2 min-w-[200px]">Descrição (extraída)</th>
                <th className="px-3 py-2">Cred. dev.</th>
                <th className="px-3 py-2 min-w-[140px]">Arquivo</th>
                <th className="px-3 py-2 min-w-[180px]">Proveniência PDF</th>
                <th className="px-3 py-2 min-w-[140px]">Enriquecimento</th>
                <th className="px-3 py-2">Pessoa</th>
                <th className="px-3 py-2">Confiança</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 min-w-[120px]">Lacunas / IA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {rows.map((row) => {
                const emRevisao = row.status === "PENDENTE_REVISAO";
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setDrawerId(row.id)}
                  >
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      {emRevisao && (
                        <input
                          type="checkbox"
                          className="rounded border-border-input"
                          checked={selected.has(row.id)}
                          onChange={(e) =>
                            toggleRevisaoSelection(row.id, e.target.checked)
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.dataMovimento}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium">
                      R$ {row.valor}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{row.direcao}</td>
                    <td className="px-3 py-2 max-w-xs">
                      <span className="line-clamp-3 whitespace-pre-wrap text-xs">
                        {row.descricaoRaw || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {row.credDev ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.nomeArquivo ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {formatOrigemPdf(row.origemExtracao)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {formatEnriquecimento(row.origemEnriquecimento)}
                    </td>
                    <td className="px-3 py-2 text-xs">{row.pessoaResumo ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={confiancaTone(row.confiancaGlobal)}>
                        {Math.round(row.confiancaGlobal * 100)}%
                      </Badge>
                      {row.bloqueioExport && (
                        <span className="mt-1 block text-[10px] text-red-700">
                          bloqueio export
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone="warn">
                        {STATUS_LABEL[row.status] ?? row.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {row.iaIndisponivel && (
                          <Badge tone="danger">IA off</Badge>
                        )}
                        {row.lacunas.slice(0, 3).map((l) => (
                          <Badge key={l} tone="warn">
                            {l}
                          </Badge>
                        ))}
                        {row.lacunas.length > 3 && (
                          <span className="text-[10px] text-muted">
                            +{row.lacunas.length - 3}
                          </span>
                        )}
                      </div>
                      {row.justificativaIa && (
                        <p
                          className="mt-1 line-clamp-2 text-[10px] text-muted"
                          title={row.justificativaIa}
                        >
                          {row.justificativaIa}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        Clique em uma linha para revisar, vincular pessoa, confirmar ou ver proveniência no PDF.
      </p>

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
