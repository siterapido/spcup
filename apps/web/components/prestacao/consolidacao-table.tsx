"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import {
  findCnpjInDescricao,
  findCpfInDescricao,
  stripDocumentsFromDescricao,
  type OrigemAtributosEvento,
  type OrigemExtracaoV1,
} from "@spc-up/core/browser";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { maskDocumento } from "@/lib/mask-document";
import { OrigensPanel } from "@/components/prestacao/origens-panel";
import {
  analisarConflitoConsolidacao,
  ConflitoConsolidacaoResumo,
} from "@/components/prestacao/conflito-consolidacao-resumo";
import {
  ConsolidacaoPlanilha,
  linhasCsvPlanilha,
} from "@/components/prestacao/consolidacao-planilha";

export type ConsolidacaoEventoRow = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  remetenteDestinatario: string | null;
  linhas: Array<{
    id: string;
    movimentacaoId: string;
    papel: string;
    descricaoRaw: string;
    nomeArquivo: string | null;
    arquivoIngestaoId?: string | null;
    origemExtracao: OrigemExtracaoV1 | null;
  }>;
  hipoteses: Array<{
    id: string;
    tipo: string;
    confianca: number;
    payload: unknown;
  }>;
  origemAtributos: OrigemAtributosEvento | null;
  pessoa: {
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
  } | null;
};

type Props = {
  sessaoId: string;
  eventos: ConsolidacaoEventoRow[];
  cadastroAlerta: boolean;
  uf?: string;
  exercicio?: number;
};

// Clean transaction descriptions to extract names
function cleanTransactionName(desc: string): string {
  if (!desc) return "";
  let name = desc;
  name = name.replace(/\b(PIX|TEV|TED|DOC|COBRANCA|TRANSF|RECEBIDO|ENVIADO|PAGTO|PGTO|DEPOSITO|DEP|LIQ|LIQUIDACAO|TARIFA|TAR|DOC\s*EXTRATO|PAGAMENTO)\b/gi, "");
  name = name.replace(/[-:;*#_]/g, " ");
  name = stripDocumentsFromDescricao(name);
  name = name.replace(/\s+/g, " ").trim();
  return name;
}

// Detect CPFs or CNPJs from raw lines
function extractDocument(ev: ConsolidacaoEventoRow) {
  for (const line of ev.linhas) {
    const cpf = findCpfInDescricao(line.descricaoRaw);
    if (cpf) return { doc: cpf, tipo: "PF" as const };
    const cnpj = findCnpjInDescricao(line.descricaoRaw);
    if (cnpj) return { doc: cnpj, tipo: "PJ" as const };
  }
  return null;
}

type PersonOption = {
  id: string;
  nome: string;
  documento: string;
  tipo: "PF" | "PJ";
  documento_mascarado?: string;
  estado?: string | null;
};

export function ConsolidacaoTable({ sessaoId, eventos, cadastroAlerta, uf = "SP", exercicio = 2026 }: Props) {
  const router = useRouter();

  // Navigation states
  const [activeTab, setActiveTab] = useState<"conflitos" | "validados" | "planilha">(
    "planilha",
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Optimistic UI list state
  const [localEventos, setLocalEventos] = useState<ConsolidacaoEventoRow[]>(eventos);
  const [transitioningIds, setTransitioningIds] = useState<Record<string, "approving" | "rejecting">>({});
  const [message, setMessage] = useState<string | null>(null);

  // New Client Modal state
  const [createModal, setCreateModal] = useState<{
    isOpen: boolean;
    nome: string;
    documento: string;
    tipo: "PF" | "PJ";
    eventoId: string;
  } | null>(null);

  // Webhook integration simulator state
  const [isWebhookOpen, setIsWebhookOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("https://n8n.seu-erp.com.br/webhook/consolidacao-bancaria");
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [webhookSuccess, setWebhookSuccess] = useState(false);

  // Sync prop changes
  useEffect(() => {
    setLocalEventos(eventos);
  }, [eventos]);

  // Lists by tab
  const pendingEvents = useMemo(() => localEventos.filter((e) => e.status === "PENDENTE"), [localEventos]);
  const validatedEvents = useMemo(() => localEventos.filter((e) => e.status !== "PENDENTE"), [localEventos]);

  // Card element refs for keyboard focus navigation
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Filenames KPI
  const processedFiles = useMemo(() => {
    return Array.from(
      new Set(
        eventos.flatMap((e) => e.linhas.map((l) => l.nomeArquivo)).filter((name): name is string => !!name)
      )
    );
  }, [eventos]);

  // Reconciliation percentage
  const totalCount = localEventos.length;
  const validadosCount = validatedEvents.length;
  const progressPct = totalCount > 0 ? Math.round((validadosCount / totalCount) * 100) : 100;

  // Single confirmation logic with slide-out transition
  const handleConfirm = useCallback(
    async (eventoId: string, index: number) => {
      // Find next element to focus before we hide the current card
      const nextCard = pendingEvents[index + 1] || pendingEvents[0];
      
      setTransitioningIds((prev) => ({ ...prev, [eventoId]: "approving" }));
      setMessage(null);

      // Slide-out delay
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Optimistic update
      setLocalEventos((prev) =>
        prev.map((e) => (e.id === eventoId ? { ...e, status: "APROVADO" } : e))
      );

      // Shift focus to next card
      if (nextCard && nextCard.id !== eventoId) {
        cardRefs.current[nextCard.id]?.focus();
      }

      // API request
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${eventoId}/aprovar`,
        { method: "POST" }
      );

      setTransitioningIds((prev) => {
        const copy = { ...prev };
        delete copy[eventoId];
        return copy;
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setMessage(json.error ?? "Erro ao aprovar");
        // Revert on error
        setLocalEventos((prev) =>
          prev.map((e) => (e.id === eventoId ? { ...e, status: "PENDENTE" } : e))
        );
        return;
      }
      router.refresh();
    },
    [router, sessaoId, pendingEvents]
  );

  // Undo approval logic
  const handleUndo = useCallback(
    async (eventoId: string) => {
      setTransitioningIds((prev) => ({ ...prev, [eventoId]: "rejecting" }));
      setMessage(null);

      await new Promise((resolve) => setTimeout(resolve, 300));

      setLocalEventos((prev) =>
        prev.map((e) => (e.id === eventoId ? { ...e, status: "PENDENTE" } : e))
      );

      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${eventoId}/rejeitar`,
        { method: "POST" }
      );

      setTransitioningIds((prev) => {
        const copy = { ...prev };
        delete copy[eventoId];
        return copy;
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setMessage(json.error ?? "Erro ao desfazer aprovação");
        setLocalEventos((prev) =>
          prev.map((e) => (e.id === eventoId ? { ...e, status: "APROVADO" } : e))
        );
        return;
      }
      router.refresh();
    },
    [router, sessaoId]
  );

  // Batch Approval
  const handleBatchApprove = async () => {
    if (selectedIds.size === 0) return;
    const idsToApprove = Array.from(selectedIds);
    setMessage(null);

    // Apply animation state to all selected cards
    setTransitioningIds((prev) => {
      const next = { ...prev };
      for (const id of idsToApprove) {
        next[id] = "approving";
      }
      return next;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Optimistically approve
    setLocalEventos((prev) =>
      prev.map((e) => (selectedIds.has(e.id) ? { ...e, status: "APROVADO" } : e))
    );

    // Clear checkboxes
    setSelectedIds(new Set());

    // Execute requests in parallel
    const promises = idsToApprove.map((id) =>
      fetch(`/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${id}/aprovar`, { method: "POST" })
    );
    const results = await Promise.all(promises);

    setTransitioningIds((prev) => {
      const copy = { ...prev };
      for (const id of idsToApprove) {
        delete copy[id];
      }
      return copy;
    });

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      setMessage(`Erro ao aprovar ${failed.length} item(ns). Fila atualizada.`);
    }

    router.refresh();
  };

  // Keyboard navigation & approval triggers
  const handleCardKeyDown = (e: React.KeyboardEvent, evId: string, index: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void handleConfirm(evId, index);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextCard = pendingEvents[index + 1];
      if (nextCard) {
        cardRefs.current[nextCard.id]?.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevCard = pendingEvents[index - 1];
      if (prevCard) {
        cardRefs.current[prevCard.id]?.focus();
      }
    }
  };

  // Checkbox toggle
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (copy.has(id)) copy.delete(id);
      else copy.add(id);
      return copy;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pendingEvents.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingEvents.map((e) => e.id)));
    }
  };

  const handleExportCSV = () => {
    if (localEventos.length === 0) return;
    const csvRows = linhasCsvPlanilha(localEventos);
    const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`;
    const csvContent =
      "\uFEFF" +
      csvRows.map((row) => row.map((c) => (c.includes(";") || c.includes('"') ? escape(c) : c)).join(";")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `consolidacao_sessao_${sessaoId}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Webhook JSON generator
  const simulatedWebhookPayload = useMemo(() => {
    return JSON.stringify(
      {
        sessaoId,
        dataConsolidacao: new Date().toISOString(),
        totalMovimentacoes: localEventos.length,
        conciliadosCount: validadosCount,
        percentualSucesso: `${progressPct}%`,
        eventos: validatedEvents.map((ev) => ({
          id: ev.id,
          data: ev.dataMovimento,
          valor: Number(ev.valor),
          direcao: ev.direcao,
          originalExtrato: ev.linhas[0]?.descricaoRaw || "",
          cliente: ev.pessoa
            ? {
                nome: ev.pessoa.nome,
                documento: ev.pessoa.documento,
                tipo: ev.pessoa.tipo,
              }
            : null,
          justificativa: ev.justificativa,
        })),
      },
      null,
      2
    );
  }, [localEventos, validatedEvents, sessaoId, validadosCount, progressPct]);

  // Triggers Webhook mockup simulation
  const handleSendWebhook = () => {
    setIsSendingWebhook(true);
    setWebhookSuccess(false);
    setTimeout(() => {
      setIsSendingWebhook(false);
      setWebhookSuccess(true);
      setTimeout(() => {
        setIsWebhookOpen(false);
        setWebhookSuccess(false);
      }, 1500);
    }, 1200);
  };

  // Handles client creation modal submit
  const handleCreateClientSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!createModal) return;

    const res = await fetch("/api/pessoas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipo: createModal.tipo,
        documento: createModal.documento.replace(/\D/g, ""),
        nome: createModal.nome,
        uf,
        exercicio,
      }),
    });

    const json = (await res.json()) as {
      error?: string;
      pessoa_fisica_id?: string | null;
      pessoa_juridica_id?: string | null;
    };

    if (!res.ok) {
      alert(json.error ?? "Erro ao cadastrar cliente");
      return;
    }

    const pfId = json.pessoa_fisica_id || null;
    const pjId = json.pessoa_juridica_id || null;

    // Link client to event in database
    const patchRes = await fetch(
      `/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${createModal.eventoId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoaFisicaId: pfId,
          pessoaJuridicaId: pjId,
          confianca: 1.0,
          justificativa: "Vínculo manual pós-cadastro",
        }),
      }
    );

    if (!patchRes.ok) {
      alert("Cliente criado, mas falhou ao vincular ao conflito.");
      setCreateModal(null);
      return;
    }

    // Update client representation in state
    setLocalEventos((prev) =>
      prev.map((ev) =>
        ev.id === createModal.eventoId
          ? {
              ...ev,
              pessoaFisicaId: pfId,
              pessoaJuridicaId: pjId,
              pessoa: {
                nome: createModal.nome,
                documento: createModal.documento,
                tipo: createModal.tipo,
              },
              confianca: 1.0,
              justificativa: "Vínculo manual pós-cadastro",
            }
          : ev
      )
    );

    setCreateModal(null);
    router.refresh();
  };

  return (
    <div className="space-y-6 pb-24">
      {/* 1. Header (Cabeçalho) */}
      <div className="flex flex-col gap-4 border-b border-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Consolidação Bancária</h1>
            <Badge tone="neutral" className="bg-slate-100 text-slate-700">
              Sessão {sessaoId}
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
            <span>Arquivos:</span>
            {processedFiles.length > 0 ? (
              <span className="font-medium text-slate-700">{processedFiles.join(", ")}</span>
            ) : (
              <span className="italic">Nenhum arquivo listado</span>
            )}
          </div>
        </div>

        {/* Closing KPIs */}
        <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-slate-50 p-3 text-center md:flex md:items-center md:text-left">
          <div className="md:px-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">Total</p>
            <p className="text-lg font-bold text-slate-800">{totalCount}</p>
          </div>
          <div className="border-x border-slate-200 md:px-4">
            <p className="text-[10px] uppercase tracking-wider text-muted">Para revisar</p>
            <p className="text-lg font-bold text-amber-600">{pendingEvents.length}</p>
          </div>
          <div className="md:px-2">
            <p className="text-[10px] uppercase tracking-wider text-muted">Validados</p>
            <p className="text-lg font-bold text-emerald-600">{validatedEvents.length}</p>
          </div>
        </div>
      </div>

      {cadastroAlerta && activeTab === "conflitos" && (
        <p className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
          <span className="text-lg">⚠️</span>
          <span>
            Cadastro da UF parece vazio para match por nome (PIX). Importe em{" "}
            <Link href="/pessoas" className="font-medium underline hover:text-amber-800">
              Cadastro
            </Link>{" "}
            antes de aprovar para ter mais sugestões inteligentes.
          </span>
        </p>
      )}

      {message && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {message}
        </div>
      )}

      {/* 2. Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200">
        <div className="flex gap-2">
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-150 ${
              activeTab === "conflitos"
                ? "border-up-black text-up-black font-semibold"
                : "border-transparent text-muted hover:text-up-black"
            }`}
            onClick={() => setActiveTab("conflitos")}
          >
            Para revisar ({pendingEvents.length})
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-150 ${
              activeTab === "validados"
                ? "border-up-black text-up-black font-semibold"
                : "border-transparent text-muted hover:text-up-black"
            }`}
            onClick={() => setActiveTab("validados")}
          >
            Validados ({validatedEvents.length})
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-all duration-150 ${
              activeTab === "planilha"
                ? "border-up-black text-up-black font-semibold"
                : "border-transparent text-muted hover:text-up-black"
            }`}
            onClick={() => setActiveTab("planilha")}
          >
            Planilha ({localEventos.length})
          </button>
        </div>

        {activeTab === "conflitos" && (
          <p className="text-sm text-slate-600 pb-2 sm:pb-0 sm:max-w-lg">
            {pendingEvents.length > 0
              ? "O sistema já conferiu cruzamento entre extratos, CPF/CNPJ e cadastro. Aqui ficam só os casos com confiança abaixo de 85% ou ambíguos — defina o titular e confira no PDF."
              : "Matches com confiança ≥ 85% e pessoa no cadastro foram aprovados automaticamente. Nada pendente de revisão manual."}
          </p>
        )}

        {/* Batch Confirmation Actions */}
        {activeTab === "conflitos" && pendingEvents.length > 0 && (
          <div className="flex items-center gap-2 py-2">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="text-xs text-slate-600 hover:text-up-black hover:underline"
            >
              {selectedIds.size === pendingEvents.length ? "Desmarcar Todos" : "Selecionar Todos"}
            </button>
            {selectedIds.size > 0 && (
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-xs px-3 py-1.5 flex items-center gap-1.5"
                onClick={() => void handleBatchApprove()}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Aprovar Selecionados ({selectedIds.size})
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {activeTab === "planilha" ? (
          <ConsolidacaoPlanilha
            eventos={localEventos}
            sessaoId={sessaoId}
            onExportarCsv={localEventos.length > 0 ? handleExportCSV : undefined}
            onMergeResolved={() => router.refresh()}
          />
        ) : activeTab === "conflitos" ? (
          pendingEvents.length === 0 ? (
            <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
              <span className="text-4xl">🎉</span>
              <h3 className="mt-3 font-semibold text-slate-800 text-lg">Nada pendente de revisão</h3>
              <p className="text-sm text-muted mt-1 max-w-sm">
                Todas as transações foram conferidas e confirmadas. Pronto para exportação.
              </p>
            </Card>
          ) : (
            pendingEvents.map((ev, index) => {
              const isApproving = transitioningIds[ev.id] === "approving";
              const isSelected = selectedIds.has(ev.id);

              return (
                <div
                  key={ev.id}
                  ref={(el) => {
                    cardRefs.current[ev.id] = el;
                  }}
                  tabIndex={0}
                  onKeyDown={(e) => handleCardKeyDown(e, ev.id, index)}
                  className={`
                    relative rounded-lg border transition-all duration-300 ease-out-quart 
                    focus-within:ring-2 focus-within:ring-up-black focus-within:ring-offset-2 outline-none
                    ${isApproving ? "bg-emerald-50 border-emerald-500 opacity-0 translate-x-12 scale-95 max-h-0 py-0 my-0 overflow-hidden border-0" : ""}
                    bg-amber-50/10 border-amber-200 hover:border-amber-400
                  `}
                >
                  <div className="px-5 pt-4">
                    <ConflitoConsolidacaoResumo
                      analise={analisarConflitoConsolidacao(ev, localEventos)}
                      eventoAtualId={ev.id}
                      onIrParaEvento={(id) => {
                        cardRefs.current[id]?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                        cardRefs.current[id]?.focus();
                      }}
                    />
                  </div>

                  <div className="flex items-stretch divide-x divide-slate-100">
                    {/* Checkbox column */}
                    <div className="flex items-center justify-center px-4 bg-slate-50/50">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(ev.id)}
                        className="h-4.5 w-4.5 rounded border-gray-300 text-up-black focus:ring-up-black cursor-pointer"
                      />
                    </div>

                    {/* Split Workspace Column Layout */}
                    <div className="grid grid-cols-1 md:grid-cols-2 w-full divide-y md:divide-y-0 md:divide-x divide-slate-100 p-5 gap-5">
                      
                      {/* Lado Esquerdo (Dados Reais do PDF) */}
                      <div className="flex flex-col justify-between space-y-3">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                              ev.direcao === "ENTRADA" 
                                ? "bg-emerald-100 text-emerald-800" 
                                : "bg-slate-100 text-slate-800"
                            }`}>
                              {ev.linhas.some((l) => l.papel === "PIX") 
                                ? `PIX ${ev.direcao === "ENTRADA" ? "RECEBIDO" : "ENVIADO"}` 
                                : `TEV ${ev.direcao === "ENTRADA" ? "RECEBIDO" : "ENVIADO"}`
                              }
                            </span>
                          </div>

                          <div className="space-y-0.5">
                            <p className={`text-xl font-bold tracking-tight ${
                              ev.direcao === "ENTRADA" ? "text-emerald-700" : "text-slate-800"
                            }`}>
                              {ev.direcao === "ENTRADA" ? "+" : "-"} R$ {ev.valor}
                            </p>
                            {ev.linhas.length <= 1 ? (
                              <p
                                className="font-medium text-slate-900 break-words line-clamp-2"
                                title={ev.linhas[0]?.descricaoRaw}
                              >
                                {ev.linhas[0]?.descricaoRaw}
                              </p>
                            ) : (
                              <ul className="space-y-2 text-sm">
                                {ev.linhas.map((linha) => (
                                  <li
                                    key={linha.id}
                                    className="rounded border border-slate-200/80 bg-white/60 px-2 py-1.5"
                                  >
                                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                      {linha.papel}
                                      {linha.nomeArquivo ? ` · ${linha.nomeArquivo}` : ""}
                                    </span>
                                    <p className="font-medium text-slate-900 break-words line-clamp-2 mt-0.5">
                                      {linha.descricaoRaw}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        {/* Metadados subtext */}
                        <div className="flex flex-wrap items-center gap-2 border-t border-slate-50 pt-2 text-xs text-muted">
                          <span>Data: {ev.dataMovimento}</span>
                          {(() => {
                            const meta = ev.linhas[0] ? ev.linhas[0].descricaoRaw : "";
                            const timeMatch = meta.match(/\b\d{2}:\d{2}(:\d{2})?\b/);
                            const docMatch = meta.match(/\b(DOC|DOCUMENTO|Nº|NUM|AUTENTICACAO|AUT)\s*:?\s*(\d+)\b/i);
                            return (
                              <>
                                {timeMatch && <span>• Hora: {timeMatch[0]}</span>}
                                {docMatch && <span>• Doc: {docMatch[2]}</span>}
                              </>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Lado Direito (A Inteligência do Sistema) */}
                      <div className="flex flex-col justify-between space-y-4 md:pl-5">
                        <div className="space-y-3">
                          {/* Smart candidate select box */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500">
                              Vincular Cliente/Fornecedor
                            </label>
                            <DropdownInteligente
                              ev={ev}
                              sessaoId={sessaoId}
                              onSelectPessoa={(p) => {
                                // Update local event object representation
                                setLocalEventos((prev) =>
                                  prev.map((e) =>
                                    e.id === ev.id
                                      ? {
                                          ...e,
                                          pessoaFisicaId: p.tipo === "PF" ? p.id : null,
                                          pessoaJuridicaId: p.tipo === "PJ" ? p.id : null,
                                          pessoa: {
                                            nome: p.nome,
                                            documento: p.documento,
                                            tipo: p.tipo,
                                          },
                                          confianca: 1.0,
                                          justificativa: "Vínculo manual pós-pesquisa",
                                        }
                                      : e
                                  )
                                );
                              }}
                              onCreateNewClient={(nome) => {
                                const docInfo = extractDocument(ev);
                                setCreateModal({
                                  isOpen: true,
                                  nome,
                                  documento: docInfo?.doc || "",
                                  tipo: docInfo?.tipo || "PF",
                                  eventoId: ev.id,
                                });
                              }}
                            />
                          </div>
                        </div>

                        {/* Confirmation trigger */}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void handleConfirm(ev.id, index)}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-4 py-2 text-sm font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                            disabled={!ev.pessoa}
                            title={!ev.pessoa ? "Vincule um cliente para confirmar" : "Confirmar reconciliação (Space ou Enter)"}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            <span>Confirmar</span>
                          </button>
                        </div>
                      </div>

                    </div>
                  </div>

                  <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
                    <OrigensPanel
                      compact
                      origemAtributos={ev.origemAtributos}
                      linhas={ev.linhas}
                    />
                  </div>
                </div>
              );
            })
          )
        ) : (
          validatedEvents.length === 0 ? (
            <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
              <span className="text-4xl">📥</span>
              <h3 className="mt-3 font-semibold text-slate-800 text-lg">Sem movimentações validadas</h3>
              <p className="text-sm text-muted mt-1 max-w-sm">
                Os itens aprovados na aba de conflitos ou conciliados de forma automática aparecerão aqui.
              </p>
            </Card>
          ) : (
            validatedEvents.map((ev) => {
              const isRejecting = transitioningIds[ev.id] === "rejecting";
              return (
                <Card
                  key={ev.id}
                  className={`p-5 transition-all duration-300 border-emerald-200 bg-emerald-50/10 ${
                    isRejecting ? "opacity-0 -translate-x-12 scale-95 max-h-0 py-0 my-0 overflow-hidden border-0" : ""
                  }`}
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 gap-5">
                    
                    {/* Left details */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge tone="success">VALIDADOR</Badge>
                        <span className="text-xs text-muted">{ev.dataMovimento}</span>
                      </div>
                      <p className={`text-lg font-bold ${
                        ev.direcao === "ENTRADA" ? "text-emerald-700" : "text-slate-700"
                      }`}>
                        {ev.direcao === "ENTRADA" ? "+" : "-"} R$ {ev.valor}
                      </p>
                      <p className="text-sm font-medium text-slate-900 break-all">
                        {ev.linhas[0]?.descricaoRaw}
                      </p>
                    </div>

                    {/* Right matched client status */}
                    <div className="flex flex-col justify-between space-y-3 md:pl-5">
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-slate-500">Conciliado com:</p>
                        {ev.pessoa ? (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50/40 p-2.5 flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">{ev.pessoa.nome}</p>
                              <p className="text-xs text-slate-600">
                                {ev.pessoa.tipo} • {maskDocumento(ev.pessoa.tipo, ev.pessoa.documento)}
                              </p>
                            </div>
                            <span className="text-emerald-600 font-bold text-sm">✓</span>
                          </div>
                        ) : (
                          <p className="text-sm italic text-muted">Sem pessoa vinculada</p>
                        )}
                        <p className="text-xs text-muted italic mt-1">{ev.justificativa}</p>
                      </div>

                      <OrigensPanel
                        compact
                        origemAtributos={ev.origemAtributos}
                        linhas={ev.linhas}
                      />

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="text-xs py-1 px-2.5 h-auto text-slate-600 border-slate-300 hover:bg-slate-50"
                          onClick={() => void handleUndo(ev.id)}
                        >
                          Estornar
                        </Button>
                      </div>
                    </div>

                  </div>
                </Card>
              );
            })
          )
        )}
      </div>

      {/* 4. Footer Fixo */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-border shadow-[0_-4px_12px_rgba(0,0,0,0.05)] px-6 py-4">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          
          {/* Progress Section */}
          <div className="flex items-center gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-700">Progresso de Revisão:</span>
                <span className="text-sm font-bold text-slate-900">{progressPct}%</span>
              </div>
              <div className="w-56 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Export Consolidação button */}
          <div className="flex items-center gap-2">
            {pendingEvents.length > 0 ? (
              <span className="text-xs text-slate-500 italic">
                Revise e confirme os {pendingEvents.length} itens restantes. Use a aba Planilha para visão geral.
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-emerald-700 font-bold flex items-center gap-1">
                  <span>[✓] 100% Conciliado com Sucesso!</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("planilha");
                  }}
                  className="bg-slate-800 hover:bg-slate-700 text-white rounded px-4 py-2 text-sm font-semibold"
                >
                  Abrir planilha
                </button>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="bg-slate-950 hover:bg-slate-800 text-white rounded px-4.5 py-2 text-sm font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={() => setIsWebhookOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded px-4.5 py-2 text-sm font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  Enviar via Webhook (n8n/ERP)
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* 5. Quick Register Modal */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Cadastrar Novo Cliente</h3>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                onClick={() => setCreateModal(null)}
              >
                ×
              </button>
            </div>
            <form onSubmit={(e) => void handleCreateClientSubmit(e)} className="p-5 space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Nome do Cliente/Fornecedor</label>
                <Input
                  required
                  type="text"
                  value={createModal.nome}
                  onChange={(e) => setCreateModal({ ...createModal, nome: e.target.value })}
                  placeholder="Nome completo ou Razão Social"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Tipo de Documento</label>
                  <select
                    className="w-full rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm text-up-black shadow-sm focus:border-up-black focus:outline-none focus:ring-1 focus:ring-up-black"
                    value={createModal.tipo}
                    onChange={(e) => setCreateModal({ ...createModal, tipo: e.target.value as "PF" | "PJ" })}
                  >
                    <option value="PF">Pessoa Física (CPF)</option>
                    <option value="PJ">Pessoa Jurídica (CNPJ)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">CPF ou CNPJ</label>
                  <Input
                    required
                    type="text"
                    value={createModal.documento}
                    onChange={(e) => setCreateModal({ ...createModal, documento: e.target.value })}
                    placeholder={createModal.tipo === "PF" ? "Ex: 12345678901" : "Ex: 12345678000100"}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-2.5 rounded border border-slate-100 text-xs text-slate-600">
                <div>
                  <span className="font-semibold">UF do Cadastro:</span> {uf}
                </div>
                <div>
                  <span className="font-semibold">Exercício:</span> {exercicio}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4 mt-2">
                <Button type="button" variant="outline" onClick={() => setCreateModal(null)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-slate-950 hover:bg-slate-800 text-white font-semibold">
                  Salvar Cadastro
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. Webhook n8n Integration Modal */}
      {isWebhookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="bg-slate-50 px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-emerald-600 text-lg">🔌</span>
                <h3 className="font-semibold text-slate-900">Enviar para Webhook (n8n / ERP)</h3>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                onClick={() => setIsWebhookOpen(false)}
                disabled={isSendingWebhook}
              >
                ×
              </button>
            </div>
            
            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">URL do Webhook do ERP</label>
                <Input
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://sua-instancia-n8n.com/webhook/..."
                  disabled={isSendingWebhook || webhookSuccess}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">Dados do Evento (Payload JSON)</label>
                <div className="bg-slate-900 text-slate-100 rounded-md p-4 overflow-auto font-mono text-xs max-h-60">
                  <pre>{simulatedWebhookPayload}</pre>
                </div>
              </div>

              {webhookSuccess && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-emerald-800 text-sm font-medium animate-pulse">
                  <span>✓</span>
                  <span>Payload enviado com sucesso para {webhookUrl}!</span>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsWebhookOpen(false)}
                disabled={isSendingWebhook}
              >
                Fechar
              </Button>
              <Button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-2"
                onClick={handleSendWebhook}
                disabled={isSendingWebhook || webhookSuccess}
              >
                {isSendingWebhook ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Enviando...</span>
                  </>
                ) : webhookSuccess ? (
                  <span>Concluído!</span>
                ) : (
                  <span>Enviar via Webhook</span>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// Custom searchable Intelligent Dropdown Select Box
// ----------------------------------------------------
type DropdownProps = {
  ev: ConsolidacaoEventoRow;
  sessaoId: string;
  onSelectPessoa: (p: PersonOption) => void;
  onCreateNewClient: (nome: string) => void;
};

function DropdownInteligente({ ev, sessaoId, onSelectPessoa, onCreateNewClient }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  // Default clean search query
  const defaultSearchName = useMemo(() => {
    return cleanTransactionName(ev.linhas[0]?.descricaoRaw || "");
  }, [ev]);

  const [searchQuery, setSearchQuery] = useState(defaultSearchName);
  const [searchResults, setSearchResults] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Fetch search results from DB
  const performSearch = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pessoas?q=${encodeURIComponent(q.trim())}`);
      const data = (await res.json()) as { items?: PersonOption[] };
      setSearchResults(data.items || []);
    } catch (err) {
      console.error("Erro na busca de pessoas:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync default search name
  useEffect(() => {
    setSearchQuery(defaultSearchName);
  }, [defaultSearchName]);

  // Load initial suggestions or search results when dropdown opens
  useEffect(() => {
    if (isOpen) {
      void performSearch(searchQuery);
    }
  }, [isOpen, performSearch, searchQuery]);

  // Link selected candidate
  const handleSelect = async (p: PersonOption) => {
    const res = await fetch(
      `/api/prestacao/sessoes/${sessaoId}/consolidacao/eventos/${ev.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pessoaFisicaId: p.tipo === "PF" ? p.id : null,
          pessoaJuridicaId: p.tipo === "PJ" ? p.id : null,
          confianca: 1.0,
          justificativa: "Vínculo manual pós-pesquisa",
        }),
      }
    );

    if (res.ok) {
      onSelectPessoa(p);
      setIsOpen(false);
    } else {
      alert("Falhou ao vincular pessoa no servidor.");
    }
  };

  return (
    <div ref={dropdownRef} className="relative w-full">
      {/* Dropdown Toggle Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-2 text-sm border rounded-md shadow-sm bg-white hover:bg-slate-50 border-slate-300 focus:outline-none focus:ring-1 focus:ring-up-black focus:border-up-black text-left"
      >
        <div className="flex items-center gap-2 overflow-hidden truncate">
          {ev.pessoa ? (
            <>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                ev.pessoa.tipo === "PF" ? "bg-blue-50 text-blue-700" : "bg-emerald-50 text-emerald-700"
              }`}>
                {ev.pessoa.tipo}
              </span>
              <span className="font-medium text-slate-800 truncate">{ev.pessoa.nome}</span>
              <span className="text-xs text-muted truncate">
                • {maskDocumento(ev.pessoa.tipo, ev.pessoa.documento)}
              </span>
            </>
          ) : (
            <span className="text-muted italic">Selecione ou crie um cliente...</span>
          )}
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Floating Dropdown List Overlay */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 z-50 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-hidden flex flex-col">
          {/* Search box input */}
          <div className="relative border-b border-slate-100 flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              autoFocus
              className="w-full pl-9 pr-3 py-2 text-sm border-0 outline-none focus:ring-0 placeholder:text-muted/50"
              placeholder="Pesquisar por nome ou CNPJ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Results list */}
          <div className="overflow-y-auto max-h-48 divide-y divide-slate-50 flex-1">
            {loading ? (
              <p className="text-xs text-muted italic p-3 text-center">Buscando cadastro...</p>
            ) : searchResults.length === 0 ? (
              <p className="text-xs text-muted italic p-3 text-center">Nenhum cliente correspondente encontrado</p>
            ) : (
              searchResults.map((p) => {
                const isCurrent = ev.pessoa?.documento === p.documento;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 text-xs flex flex-col gap-0.5 hover:bg-slate-50 ${
                      isCurrent ? "bg-slate-50 font-semibold" : ""
                    }`}
                    onClick={() => void handleSelect(p)}
                  >
                    <span className="font-medium text-slate-800 flex items-center gap-1.5">
                      <span className={`text-[9px] px-1 py-0.1 rounded font-bold ${
                        p.tipo === "PF" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                      }`}>
                        {p.tipo}
                      </span>
                      {p.nome}
                      {isCurrent && <span className="text-[10px] text-emerald-600 ml-auto">✓ selecionado</span>}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {p.documento_mascarado || maskDocumento(p.tipo, p.documento)} {p.estado ? `· ${p.estado}` : ""}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* "+ Criar novo cliente" footer action */}
          <button
            type="button"
            className="w-full text-left px-3 py-2 border-t border-slate-100 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-up-black flex items-center gap-1.5"
            onClick={() => {
              onCreateNewClient(searchQuery);
              setIsOpen(false);
            }}
          >
            <span>+</span>
            <span>Criar novo cliente com o nome &quot;{searchQuery}&quot;</span>
          </button>
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
        Revise movimentações entre extratos e vínculo com cadastro antes da lista final.
      </p>
      <p className="text-xs text-muted">Sessão {sessaoId}</p>
    </>
  );
}

