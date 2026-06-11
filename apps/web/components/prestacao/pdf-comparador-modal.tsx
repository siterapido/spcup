"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";

import { PdfOrigemPainel } from "@/components/prestacao/pdf-origem-painel";
import { Button } from "@/components/ui/button";
import { selecionarOrigensPixCompleto } from "@/lib/pdf-comparador-origens";

import {
  explicarDiferencaDataPixCompleto,
  type DiferencaDataPixCompleto,
  type PlanilhaLinha,
  type PlanilhaOrigem,
} from "@spc-up/core/browser";

const HORA_TOLERANCIA_MIN = 5;

type PdfComparadorModalProps = {
  open: boolean;
  onClose: () => void;
  linha: PlanilhaLinha;
  sessaoId: string;
  onMergeResolved: () => void;
};

function origemDisponivel(origem: PlanilhaOrigem | null): origem is PlanilhaOrigem {
  return origem != null && Boolean(origem.arquivoIngestaoId);
}

type CampoLido = { valor: string | null; fonte: string };

function lerCampo(
  origem: PlanilhaOrigem | null,
  key: string,
  fallbacks: Array<{ ler: () => string | null | undefined; fonte: string }> = [],
): CampoLido {
  if (!origem) return { valor: null, fonte: "ausente" };
  const fromCampos = origem.camposExtracao?.[key];
  if (fromCampos != null && fromCampos !== "") {
    return { valor: String(fromCampos), fonte: key };
  }
  for (const fb of fallbacks) {
    const v = fb.ler();
    if (v != null && v !== "") {
      return { valor: String(v), fonte: fb.fonte };
    }
  }
  return { valor: null, fonte: "—" };
}

function dataOrigem(origem: PlanilhaOrigem | null, fallback: string): string {
  return lerCampo(origem, "data").valor ?? fallback;
}

function origemPaginaLinha(origem: PlanilhaOrigem | null): string {
  if (!origem) return "—";
  const pagina = origem.pagina ?? origem.origemExtracao?.pagina;
  const linhaIdx = origem.indiceLinha ?? origem.origemExtracao?.indiceLinha;
  if (pagina && linhaIdx) return `p.${pagina} · linha ${linhaIdx}`;
  if (pagina) return `p.${pagina}`;
  if (linhaIdx) return `linha ${linhaIdx}`;
  return "—";
}

function documentoDdHhMm(raw: string | null): { dia: string; hora: string } | null {
  const digits = raw?.replace(/\D/g, "") ?? "";
  if (digits.length !== 6) return null;
  const dia = digits.slice(0, 2);
  const hh = digits.slice(2, 4);
  const mm = digits.slice(4, 6);
  const h = Number(hh);
  const m = Number(mm);
  if (Number(dia) < 1 || Number(dia) > 31 || h > 23 || m > 59) return null;
  return { dia, hora: `${hh}:${mm}` };
}

function minutos(raw: string | null): number | null {
  const match = raw?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = match[3] ? Number(match[3]) : 0;
  if (h > 23 || m > 59 || s > 59) return null;
  return h * 60 + m + s / 60;
}

function diaIso(data: string): string | null {
  const match = data.match(/^\d{4}-\d{2}-(\d{2})$/);
  return match?.[1] ?? null;
}

function diffMinutos(a: string | null, b: string | null): number | null {
  const ma = minutos(a);
  const mb = minutos(b);
  if (ma == null || mb == null) return null;
  return Math.abs(ma - mb);
}

function normalizarValor(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
  const n = Number.parseFloat(cleaned);
  if (Number.isNaN(n)) return raw.trim() || null;
  return Math.abs(n).toFixed(2);
}

type EvidenciaRow = {
  campo: string;
  pix: string;
  completo: string;
  status: "ok" | "warn" | "info" | "danger";
  regra: string;
};

function buildEvidencias(
  linha: PlanilhaLinha,
  pix: PlanilhaOrigem | null,
  completo: PlanilhaOrigem | null,
  diffData: DiferencaDataPixCompleto,
): EvidenciaRow[] {
  const pixHoraLido = lerCampo(pix, "hora", [
    { ler: () => pix?.origemExtracao?.horaContraparte, fonte: "horaContraparte" },
  ]);
  const pixValorLido = lerCampo(pix, "valor", [
    { ler: () => linha.valor, fonte: "consolidado" },
  ]);
  const completoDocLido = lerCampo(completo, "documento", [
    { ler: () => completo?.nrExtratoBancario, fonte: "nrExtrato" },
    { ler: () => linha.nrExtratoBancario, fonte: "consolidado" },
  ]);
  const docTime = documentoDdHhMm(completoDocLido.valor);
  const deltaHora = diffMinutos(pixHoraLido.valor, docTime?.hora ?? null);
  const diaMatchDoc = docTime?.dia && diaIso(diffData.dataPix) === docTime.dia;

  const completoValorLido = lerCampo(completo, "valor", [
    { ler: () => linha.valor, fonte: "consolidado" },
  ]);
  const valorConsolidado = normalizarValor(linha.valor);
  const valorPix = normalizarValor(pixValorLido.valor);
  const valorCompleto = normalizarValor(completoValorLido.valor);
  const valoresBatem =
    valorConsolidado != null &&
    (valorPix == null || valorPix === valorConsolidado) &&
    (valorCompleto == null || valorCompleto === valorConsolidado);

  const pixRemetente = lerCampo(pix, "remetente_destinatario", [
    { ler: () => pix?.descricaoRaw, fonte: "texto bruto" },
  ]);
  const completoRemetente = lerCampo(completo, "remetente_destinatario", [
    { ler: () => lerCampo(completo, "historico").valor, fonte: "historico" },
    { ler: () => completo?.descricaoRaw, fonte: "texto bruto" },
  ]);

  let dataStatus: EvidenciaRow["status"] = "ok";
  let dataRegra = "mesma data nos extratos";
  if (!diffData.mesmoDia) {
    dataStatus = diffData.status === "warn" ? "warn" : "info";
    dataRegra = diffData.motivo ?? `+${diffData.diffDias} dia(s)`;
  } else if (docTime && !diaMatchDoc) {
    dataStatus = "warn";
    dataRegra = "dia no documento ≠ dia do PIX";
  } else if (docTime && diaMatchDoc) {
    dataRegra = "dia no documento DDHHMM = dia PIX";
  }

  return [
    {
      campo: "Data",
      pix: diffData.dataPix,
      completo: diffData.dataCompleto,
      status: dataStatus,
      regra: dataRegra,
    },
    {
      campo: "Valor",
      pix: pixValorLido.valor ? `R$ ${pixValorLido.valor}` : "—",
      completo: completoValorLido.valor ? `R$ ${completoValorLido.valor}` : "—",
      status: valoresBatem ? "ok" : "danger",
      regra: valoresBatem ? "iguais" : "diverge",
    },
    {
      campo: "Hora",
      pix: pixHoraLido.valor ?? "—",
      completo: docTime ? docTime.hora : "—",
      status:
        deltaHora == null ? "info" : deltaHora <= HORA_TOLERANCIA_MIN ? "ok" : "warn",
      regra:
        deltaHora == null
          ? "sem cruzar"
          : deltaHora <= HORA_TOLERANCIA_MIN
            ? `Δ ${deltaHora.toFixed(1)}m`
            : `Δ ${deltaHora.toFixed(1)}m > ${HORA_TOLERANCIA_MIN}m`,
    },
    {
      campo: "Remetente",
      pix: pixRemetente.valor ?? "—",
      completo: completoRemetente.valor ?? "—",
      status: linha.remetenteDestinatario ? "ok" : "warn",
      regra: linha.remetenteDestinatario ? "preenchido" : "vazio",
    },
    {
      campo: "Documento",
      pix:
        lerCampo(pix, "documento", [{ ler: () => pix?.nrExtratoBancario, fonte: "nrExtrato" }])
          .valor ?? "—",
      completo: completoDocLido.valor ?? "—",
      status: completoDocLido.valor ? "ok" : "warn",
      regra: completoDocLido.valor
        ? docTime
          ? `DDHHMM ${docTime.dia}${docTime.hora.replace(":", "")}`
          : "no completo"
        : "ausente",
    },
  ];
}

function statusMark(status: EvidenciaRow["status"]): { char: string; className: string } {
  switch (status) {
    case "ok":
      return { char: "✓", className: "text-emerald-700" };
    case "warn":
      return { char: "?", className: "text-amber-700" };
    case "danger":
      return { char: "✗", className: "text-red-700" };
    default:
      return { char: "·", className: "text-slate-400" };
  }
}

function podeConfirmar(
  evidencias: EvidenciaRow[],
  pix: PlanilhaOrigem | null,
  completo: PlanilhaOrigem | null,
): boolean {
  if (!pix || !completo) return false;
  return !evidencias.some((e) => e.status === "danger");
}

function painelProps(
  origem: PlanilhaOrigem,
  linha: PlanilhaLinha,
): ComponentProps<typeof PdfOrigemPainel> {
  const ext = origem.origemExtracao;
  const bbox = origem.bbox ?? ext?.bbox;
  const dataMov = lerCampo(origem, "data").valor ?? linha.dataMovimento;
  const valorOrigem = lerCampo(origem, "valor").valor ?? linha.valor;
  const remetente =
    lerCampo(origem, "remetente_destinatario").valor ?? linha.remetenteDestinatario;
  const documento = lerCampo(origem, "documento", [
    { ler: () => origem.nrExtratoBancario, fonte: "nrExtrato" },
  ]).valor;
  const hora = lerCampo(origem, "hora", [
    { ler: () => ext?.horaContraparte, fonte: "horaContraparte" },
  ]).valor;
  const historico = lerCampo(origem, "historico").valor;
  const descricaoBusca =
    [remetente, historico, origem.descricaoRaw].filter(Boolean).join(" ").trim() ||
    linha.descricaoRaw;

  return {
    arquivoIngestaoId: origem.arquivoIngestaoId!,
    nomeArquivo: origem.nomeArquivo ?? "extrato.pdf",
    papel: origem.papel,
    paginaInicial: origem.pagina ?? ext?.pagina ?? 1,
    bbox,
    highlightMode: bbox ? "extracao" : "none",
    indiceLinha: origem.indiceLinha ?? ext?.indiceLinha,
    dataMovimento: dataMov,
    valor: valorOrigem,
    descricaoRaw: descricaoBusca,
    remetenteDestinatario: remetente,
    documento,
    hora,
    relaxarDataNaLinha: origem.papel === "PIX",
    ancoragem: ext?.ancoragem ?? null,
    highlightFallback:
      ext?.ancoragem === "nao_localizado"
        ? "none"
        : remetente || documento
          ? "text"
          : "text-then-row-index",
    compact: true,
    fillHeight: true,
  };
}

function PdfColuna({
  label,
  origem,
  linha,
}: {
  label: string;
  origem: PlanilhaOrigem | null;
  linha: PlanilhaLinha;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-slate-200 last:border-r-0">
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-900">{label}</p>
          <p className="truncate text-[11px] text-muted">
            {origem?.nomeArquivo ?? "ausente"} · {origemPaginaLinha(origem)}
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {origemDisponivel(origem) ? (
          <PdfOrigemPainel {...painelProps(origem, linha)} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            PDF não disponível
          </div>
        )}
      </div>
    </div>
  );
}

function ConferenciaRail({
  rows,
  diffData,
}: {
  rows: EvidenciaRow[];
  diffData: DiferencaDataPixCompleto;
}) {
  const alertas = rows.filter((r) => r.status === "warn" || r.status === "danger").length;

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 px-3 py-2">
        <p className="text-xs font-semibold text-slate-900">Conferência</p>
        <p className="text-[11px] text-muted">
          {alertas === 0 ? "todos os campos OK" : `${alertas} para revisar no PDF`}
        </p>
        {!diffData.mesmoDia && diffData.motivo && (
          <p
            className={`mt-1.5 text-[11px] leading-snug ${
              diffData.status === "warn" ? "text-amber-800" : "text-slate-700"
            }`}
          >
            {diffData.motivo}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => {
          const mark = statusMark(row.status);
          return (
            <div
              key={row.campo}
              className="border-b border-slate-200/80 px-3 py-2 text-[11px]"
            >
              <div className="flex items-center gap-1.5">
                <span className={`font-mono text-sm font-bold ${mark.className}`}>
                  {mark.char}
                </span>
                <span className="font-medium text-slate-800">{row.campo}</span>
                <span className="ml-auto text-right text-muted">{row.regra}</span>
              </div>
              <div className="mt-1 space-y-0.5 pl-5 text-slate-700">
                <p className="truncate" title={row.pix}>
                  <span className="text-muted">PIX:</span> {row.pix}
                </p>
                <p className="truncate" title={row.completo}>
                  <span className="text-muted">CMP:</span> {row.completo}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function PdfComparadorModal({
  open,
  onClose,
  linha,
  sessaoId,
  onMergeResolved,
}: PdfComparadorModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSeparar, setConfirmSeparar] = useState(false);

  const { pix, completo } = selecionarOrigensPixCompleto(linha.origens);

  const resolveMerge = useCallback(
    async (acao: "confirmar" | "separar") => {
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
        if (res.ok) {
          onMergeResolved();
          onClose();
        }
      } finally {
        setBusy(false);
        setConfirmSeparar(false);
      }
    },
    [sessaoId, linha.id, linha.fonte, onMergeResolved, onClose],
  );

  useEffect(() => {
    if (!open) {
      setConfirmSeparar(false);
      return;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (confirmSeparar) {
          setConfirmSeparar(false);
        } else {
          onClose();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, confirmSeparar]);

  if (!open) {
    return null;
  }

  const pessoaLabel = linha.pessoa?.nome ?? "—";
  const diffData = explicarDiferencaDataPixCompleto(
    dataOrigem(pix, linha.dataMovimento),
    dataOrigem(completo, linha.dataMovimento),
  );
  const evidencias = buildEvidencias(linha, pix, completo, diffData);
  const confirmarOk = podeConfirmar(evidencias, pix, completo);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-900/80"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-comparador-titulo"
        tabIndex={-1}
        className="flex h-full w-full flex-col bg-white outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 flex-col gap-0.5 border-b border-slate-200 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <h2 id="pdf-comparador-titulo" className="sr-only">
              Comparar PDFs
            </h2>
            <span className="font-semibold tabular-nums">{linha.dataMovimento}</span>
            <span className="font-semibold tabular-nums">R$ {linha.valor}</span>
            <span className="text-muted">{linha.direcao}</span>
            <span className="truncate text-slate-700">{pessoaLabel}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted">
              {linha.justificativa ?? "sem justificativa"} ({Math.round(linha.confianca * 100)}%)
            </span>
          </div>
          {!diffData.mesmoDia && diffData.motivo && (
            <p
              className={`text-xs ${
                diffData.status === "warn" ? "text-amber-800" : "text-slate-600"
              }`}
            >
              Datas PIX {diffData.dataPix} → completo {diffData.dataCompleto}: {diffData.motivo}
            </p>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1">
            <PdfColuna label="PIX" origem={pix} linha={linha} />
            <PdfColuna label="COMPLETO" origem={completo} linha={linha} />
          </div>
          <ConferenciaRail rows={evidencias} diffData={diffData} />
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-3 py-2">
          {confirmSeparar ? (
            <>
              <p className="text-sm text-slate-700">
                Separar desfaz o vínculo. Cada PDF vira linha independente.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmSeparar(false)}>
                  Cancelar
                </Button>
                <Button variant="destructive" size="sm" disabled={busy} onClick={() => void resolveMerge("separar")}>
                  Confirmar separação
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">
                Destaque verde = extração exata · azul tracejado = localizado por texto/linha
              </p>
              <div className="flex gap-2">
                {linha.status === "merge_pendente" && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy || !confirmarOk}
                      onClick={() => void resolveMerge("confirmar")}
                    >
                      Confirmar merge
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmSeparar(true)}
                    >
                      Separar
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                  Fechar
                </Button>
              </div>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
