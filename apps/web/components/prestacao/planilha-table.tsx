"use client";

import { useCallback, useMemo, useState } from "react";

import type { PlanilhaLinha, PlanilhaOrigem, PlanilhaPayload } from "@spc-up/core";
import type { BboxNorm } from "@spc-up/core/browser";

import { PlanilhaPessoaCell } from "@/components/prestacao/planilha-pessoa-cell";
import {
  PlanilhaFilter,
  PlanilhaToolbar,
} from "@/components/prestacao/planilha-toolbar";
import { PdfOrigemViewer } from "@/components/prestacao/pdf-origem-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const LIMIAR_BAIXA = 0.6;

function confiancaTone(v: number): "success" | "warn" | "danger" {
  if (v >= 0.85) return "success";
  if (v >= 0.6) return "warn";
  return "danger";
}

function statusLabel(status: PlanilhaLinha["status"]): string {
  switch (status) {
    case "pronta":
      return "Pronta";
    case "merge_pendente":
      return "Merge pendente";
    case "extracao_duvidosa":
      return "Extração duvidosa";
    default:
      return "Pendente";
  }
}

function statusTone(status: PlanilhaLinha["status"]): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "pronta":
      return "success";
    case "merge_pendente":
      return "warn";
    case "extracao_duvidosa":
      return "danger";
    default:
      return "neutral";
  }
}

function rowKey(linha: PlanilhaLinha): string {
  return `${linha.fonte}:${linha.id}`;
}

function matchesFilter(linha: PlanilhaLinha, filter: PlanilhaFilter): boolean {
  switch (filter) {
    case "sem_pessoa":
      return !linha.pessoa;
    case "baixa_confianca":
      return linha.confianca < LIMIAR_BAIXA;
    case "merge_pendente":
      return linha.status === "merge_pendente";
    case "extracao_duvidosa":
      return linha.status === "extracao_duvidosa";
    default:
      return true;
  }
}

type PdfPanel = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
  highlightLabel?: string;
  indiceLinha?: number;
};

type PessoaItem = {
  id: string;
  tipo: string;
  documento_mascarado: string;
  nome: string;
};

export function PlanilhaView({
  sessaoId,
  initial,
}: {
  sessaoId: string;
  initial: PlanilhaPayload;
}) {
  const [linhas, setLinhas] = useState(initial.linhas);
  const [resumo, setResumo] = useState(initial.resumo);
  const [filter, setFilter] = useState<PlanilhaFilter>("todos");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pdfPanel, setPdfPanel] = useState<PdfPanel | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchQ, setBatchQ] = useState("");
  const [batchPessoas, setBatchPessoas] = useState<PessoaItem[]>([]);

  const filtered = useMemo(
    () => linhas.filter((l) => matchesFilter(l, filter)),
    [linhas, filter],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/prestacao/sessoes/${sessaoId}/planilha`);
    if (!res.ok) return;
    const json = (await res.json()) as PlanilhaPayload;
    setLinhas(json.linhas);
    setResumo(json.resumo);
  }, [sessaoId]);

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmarExtracao(linha: PlanilhaLinha) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linha.id}/extracao`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fonte: linha.fonte }),
        },
      );
      if (res.ok) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resolveMerge(linha: PlanilhaLinha, acao: "confirmar" | "separar") {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linha.id}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao, fonte: linha.fonte }),
        },
      );
      if (res.ok) await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function abrirPdf(origem: PlanilhaOrigem) {
    if (origem.arquivoIngestaoId && origem.pagina != null) {
      setPdfPanel({
        arquivoIngestaoId: origem.arquivoIngestaoId,
        nomeArquivo: origem.nomeArquivo ?? "extrato.pdf",
        pagina: origem.pagina,
        highlightLabel: origem.papel
          ? `${origem.papel} · ${origem.nomeArquivo ?? ""}`
          : undefined,
      });
      setPdfOpen(true);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/movimentacoes/${origem.movimentacaoId}`);
      const json = await res.json();
      if (!res.ok) return;
      const item = json.item ?? json;
      const o = item.origemExtracao;
      if (!o?.arquivoIngestaoId || !o.pagina) return;
      setPdfPanel({
        arquivoIngestaoId: o.arquivoIngestaoId,
        nomeArquivo:
          origem.nomeArquivo ?? item.nomeArquivo ?? o.nomeArquivo ?? "extrato.pdf",
        pagina: o.pagina,
        bbox: o.bbox,
        highlightLabel: origem.papel
          ? `${origem.papel} · ${origem.nomeArquivo ?? ""}`
          : undefined,
        indiceLinha: o.indiceLinha,
      });
      setPdfOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function aplicarLote(pessoa: PessoaItem) {
    const items = linhas
      .filter((l) => selected.has(rowKey(l)))
      .map((l) => ({ id: l.id, fonte: l.fonte }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/prestacao/sessoes/${sessaoId}/planilha/lote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          ...(pessoa.tipo === "PF"
            ? { pessoaFisicaId: pessoa.id }
            : { pessoaJuridicaId: pessoa.id }),
        }),
      });
      if (res.ok) {
        setSelected(new Set());
        setBatchOpen(false);
        setBatchQ("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function scrollToPendencias() {
    document.getElementById("planilha-pendencias")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="space-y-6">
      <PlanilhaToolbar
        resumo={resumo}
        sessaoId={sessaoId}
        activeFilter={filter}
        onFilterChange={setFilter}
        onExportBlockedClick={scrollToPendencias}
      />

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-default bg-slate-50 px-4 py-2">
          <span className="text-sm">{selected.size} selecionada(s)</span>
          <Button
            type="button"
            className="px-3 py-1.5 text-xs"
            disabled={busy}
            onClick={() => setBatchOpen(true)}
          >
            Aplicar pessoa
          </Button>
          <button
            type="button"
            className="text-xs text-muted underline"
            onClick={() => setSelected(new Set())}
          >
            Limpar seleção
          </button>
        </div>
      )}

      <div id="planilha-pendencias" className="overflow-x-auto rounded-md border border-border-default">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-border-default bg-slate-50 text-xs font-medium text-muted">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Direção</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">PF/PJ</th>
              <th className="px-3 py-2">Confiança</th>
              <th className="px-3 py-2">Origens</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted">
                  Nenhuma linha neste filtro.
                </td>
              </tr>
            ) : (
              filtered.map((linha) => {
                const key = rowKey(linha);
                const isExpanded = expanded.has(linha.id);
                return (
                  <tr key={key} className="border-b border-border-default align-top hover:bg-slate-50/50">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => toggleSelect(key)}
                        aria-label={`Selecionar linha ${linha.id}`}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{linha.dataMovimento}</td>
                    <td className="whitespace-nowrap px-3 py-2">R$ {linha.valor}</td>
                    <td className="px-3 py-2">{linha.direcao}</td>
                    <td className="max-w-[14rem] px-3 py-2">
                      <span className="line-clamp-2" title={linha.descricao}>
                        {linha.descricao}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <PlanilhaPessoaCell
                        sessaoId={sessaoId}
                        linhaId={linha.id}
                        fonte={linha.fonte}
                        pessoa={linha.pessoa}
                        onUpdated={() => void refresh()}
                        disabled={busy}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={confiancaTone(linha.confianca)}>
                        {Math.round(linha.confianca * 100)}%
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {linha.origens.length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div>
                          <button
                            type="button"
                            className="text-xs font-medium underline"
                            onClick={() => toggleExpand(linha.id)}
                          >
                            <Badge tone="neutral">{linha.origens.length} origens</Badge>
                          </button>
                          {isExpanded && (
                            <ul className="mt-2 space-y-1 text-xs text-muted">
                              {linha.origens.map((o) => (
                                <li key={o.movimentacaoId} className="rounded border border-slate-100 p-2">
                                  <span className="font-medium text-slate-800">
                                    {o.nomeArquivo ?? "PDF"}
                                    {o.pagina != null ? ` · p.${o.pagina}` : ""}
                                  </span>
                                  {o.papel ? <span> · {o.papel}</span> : null}
                                  <p className="mt-0.5 whitespace-pre-wrap">{o.descricaoRaw}</p>
                                  <button
                                    type="button"
                                    className="mt-1 text-primary underline"
                                    disabled={busy}
                                    onClick={() => void abrirPdf(o)}
                                  >
                                    Ver PDF
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(linha.status)}>{statusLabel(linha.status)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {linha.status === "extracao_duvidosa" && (
                          <Button
                            type="button"
                            variant="outline"
                            className="px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => void confirmarExtracao(linha)}
                          >
                            Confirmar extração
                          </Button>
                        )}
                        {linha.status === "merge_pendente" && linha.fonte === "consolidacao" && (
                          <>
                            <Button
                              type="button"
                              className="px-2 py-1 text-xs"
                              disabled={busy}
                              onClick={() => void resolveMerge(linha, "confirmar")}
                            >
                              Confirmar merge
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="px-2 py-1 text-xs"
                              disabled={busy}
                              onClick={() => void resolveMerge(linha, "separar")}
                            >
                              Manter separado
                            </Button>
                          </>
                        )}
                        {linha.origens.length === 1 && (
                          <button
                            type="button"
                            className="text-left text-xs text-primary underline"
                            disabled={busy}
                            onClick={() => void abrirPdf(linha.origens[0]!)}
                          >
                            Ver PDF
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {batchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-lg border border-border-default bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold">Aplicar pessoa em lote</h3>
            <p className="mt-1 text-xs text-muted">
              {selected.size} linha(s) selecionada(s)
            </p>
            <Input
              type="search"
              placeholder="Buscar por nome ou documento…"
              className="mt-4"
              value={batchQ}
              onChange={(e) => {
                const v = e.target.value;
                setBatchQ(v);
                if (v.trim().length < 2) {
                  setBatchPessoas([]);
                  return;
                }
                void fetch(`/api/pessoas?q=${encodeURIComponent(v.trim())}`)
                  .then((r) => r.json())
                  .then((json) => setBatchPessoas(json.items ?? []))
                  .catch(() => setBatchPessoas([]));
              }}
            />
            {batchPessoas.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-border-default">
                {batchPessoas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs hover:bg-slate-50"
                      disabled={busy}
                      onClick={() => void aplicarLote(p)}
                    >
                      {p.nome} · {p.documento_mascarado} ({p.tipo})
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="px-3 py-1.5 text-xs"
                onClick={() => setBatchOpen(false)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {pdfPanel && (
        <PdfOrigemViewer
          open={pdfOpen}
          onClose={() => {
            setPdfOpen(false);
            setPdfPanel(null);
          }}
          arquivoIngestaoId={pdfPanel.arquivoIngestaoId}
          nomeArquivo={pdfPanel.nomeArquivo}
          pagina={pdfPanel.pagina}
          bbox={pdfPanel.bbox}
          highlightLabel={pdfPanel.highlightLabel}
          indiceLinha={pdfPanel.indiceLinha}
        />
      )}
    </div>
  );
}
