"use client";

import { Fragment, useMemo, useState } from "react";

import type { ConsolidacaoEventoRow } from "@/components/prestacao/consolidacao-table";
import { PdfComparadorModal } from "@/components/prestacao/pdf-comparador-modal";
import { PdfOrigemViewer } from "@/components/prestacao/pdf-origem-viewer";
import { maskDocumento } from "@/lib/mask-document";
import { planilhaLinhaFromEvento } from "@/lib/planilha-linha-from-evento";

import type { PlanilhaLinha } from "@spc-up/core";

import { findCnpjInDescricao, findCpfInDescricao, type BboxNorm } from "@spc-up/core/browser";

type LinhaDocumento = ConsolidacaoEventoRow["linhas"][number];

export type LinhaPlanilhaDocumento = {
  evento: ConsolidacaoEventoRow;
  linha: LinhaDocumento | null;
  indiceEvento: number;
  indiceDocumento: number;
};

function formatarValorCelula(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function docNaDescricao(descricaoRaw: string): string | null {
  return findCpfInDescricao(descricaoRaw) ?? findCnpjInDescricao(descricaoRaw);
}

/** Vermelho (baixo) → amarelo (médio) → verde (alto). Sem valor = branco. */
export function estiloConfiancaCelula(confianca: number, temValor: boolean): string {
  if (!temValor) {
    return "bg-white text-slate-300";
  }
  if (confianca >= 0.85) {
    return "bg-emerald-300/90 text-emerald-950";
  }
  if (confianca >= 0.6) {
    return "bg-amber-200 text-amber-950";
  }
  return "bg-red-200 text-red-950";
}

type ColunaPlanilha = {
  id: string;
  titulo: string;
  grupo: "evento" | "documento" | "cadastro";
  valor: (row: LinhaPlanilhaDocumento) => string | null;
};

const COLUNAS: ColunaPlanilha[] = [
  {
    id: "confianca",
    titulo: "Confiabilidade %",
    grupo: "evento",
    valor: (r) => `${Math.round(r.evento.confianca * 100)}`,
  },
  { id: "status", titulo: "Status", grupo: "evento", valor: (r) => r.evento.status },
  { id: "data", titulo: "Data", grupo: "evento", valor: (r) => r.evento.dataMovimento },
  { id: "valor", titulo: "Valor (R$)", grupo: "evento", valor: (r) => r.evento.valor },
  { id: "direcao", titulo: "Direção", grupo: "evento", valor: (r) => r.evento.direcao },
  {
    id: "arquivo",
    titulo: "Documento (PDF)",
    grupo: "documento",
    valor: (r) => formatarValorCelula(r.linha?.nomeArquivo),
  },
  { id: "papel", titulo: "Papel", grupo: "documento", valor: (r) => formatarValorCelula(r.linha?.papel) },
  {
    id: "descricao",
    titulo: "Descrição no extrato",
    grupo: "documento",
    valor: (r) => formatarValorCelula(r.linha?.descricaoRaw),
  },
  {
    id: "pagina",
    titulo: "Página",
    grupo: "documento",
    valor: (r) =>
      r.linha?.origemExtracao?.pagina != null ? String(r.linha.origemExtracao.pagina) : null,
  },
  {
    id: "linha_pdf",
    titulo: "Linha no PDF",
    grupo: "documento",
    valor: (r) =>
      r.linha?.origemExtracao?.indiceLinha != null
        ? String(r.linha.origemExtracao.indiceLinha)
        : null,
  },
  {
    id: "cpf_cnpj",
    titulo: "CPF/CNPJ na linha",
    grupo: "documento",
    valor: (r) => (r.linha ? docNaDescricao(r.linha.descricaoRaw) : null),
  },
  {
    id: "nome_cadastro",
    titulo: "Nome cadastro",
    grupo: "cadastro",
    valor: (r) => formatarValorCelula(r.evento.pessoa?.nome),
  },
  {
    id: "doc_cadastro",
    titulo: "Documento cadastro",
    grupo: "cadastro",
    valor: (r) =>
      r.evento.pessoa ? maskDocumento(r.evento.pessoa.tipo, r.evento.pessoa.documento) : null,
  },
  { id: "tipo", titulo: "Tipo PF/PJ", grupo: "cadastro", valor: (r) => r.evento.pessoa?.tipo ?? null },
  {
    id: "justificativa",
    titulo: "Justificativa",
    grupo: "evento",
    valor: (r) => formatarValorCelula(r.evento.justificativa),
  },
];

const COLUNAS_EVENTO = COLUNAS.filter((c) => c.grupo === "evento");
const COLUNAS_DOCUMENTO = COLUNAS.filter((c) => c.grupo === "documento");
const COLUNAS_CADASTRO = COLUNAS.filter((c) => c.grupo === "cadastro");

const GRUPO_LABEL: Record<ColunaPlanilha["grupo"], string> = {
  evento: "Transação",
  documento: "Documento",
  cadastro: "Cadastro",
};

function ordenarEventos(eventos: ConsolidacaoEventoRow[]): ConsolidacaoEventoRow[] {
  return [...eventos].sort((a, b) => {
    const d = a.dataMovimento.localeCompare(b.dataMovimento);
    if (d !== 0) return d;
    return Number(b.valor) - Number(a.valor);
  });
}

function expandirLinhasDocumento(eventos: ConsolidacaoEventoRow[]): LinhaPlanilhaDocumento[] {
  const rows: LinhaPlanilhaDocumento[] = [];
  ordenarEventos(eventos).forEach((evento, indiceEvento) => {
    if (evento.linhas.length === 0) {
      rows.push({
        evento,
        linha: null,
        indiceEvento: indiceEvento + 1,
        indiceDocumento: 0,
      });
      return;
    }
    evento.linhas.forEach((linha, i) => {
      rows.push({
        evento,
        linha,
        indiceEvento: indiceEvento + 1,
        indiceDocumento: i + 1,
      });
    });
  });
  return rows;
}

function linhasDoEvento(evento: ConsolidacaoEventoRow, indiceEvento: number): LinhaPlanilhaDocumento[] {
  if (evento.linhas.length === 0) {
    return [{ evento, linha: null, indiceEvento, indiceDocumento: 0 }];
  }
  return evento.linhas.map((linha, i) => ({
    evento,
    linha,
    indiceEvento,
    indiceDocumento: i + 1,
  }));
}

type ViewerState = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
  highlightLabel: string;
  indiceLinha?: number;
};

function CelulaPlanilha({
  valor,
  confianca,
  className = "",
}: {
  valor: string | null;
  confianca: number;
  className?: string;
}) {
  const temValor = valor != null;
  return (
    <td
      title={temValor ? `Confiabilidade: ${Math.round(confianca * 100)}%` : undefined}
      className={`border border-slate-200 px-2 py-1.5 max-w-[300px] align-top break-words ${estiloConfiancaCelula(confianca, temValor)} ${className}`}
    >
      {temValor ? valor : ""}
    </td>
  );
}

function CabecalhoGrupos({ extraCols = 2 }: { extraCols?: number }) {
  return (
    <>
      <tr>
        <th
          colSpan={extraCols}
          className="sticky left-0 z-20 border border-slate-300 bg-slate-200"
        />
        {(["evento", "documento", "cadastro"] as const).map((grupo) => {
          const cols = COLUNAS.filter((c) => c.grupo === grupo);
          return (
            <th
              key={grupo}
              colSpan={cols.length}
              className={`border border-slate-300 px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide ${
                grupo === "documento"
                  ? "bg-sky-100 text-sky-900"
                  : grupo === "cadastro"
                    ? "bg-violet-100 text-violet-900"
                    : "bg-slate-200 text-slate-700"
              }`}
            >
              {GRUPO_LABEL[grupo]}
            </th>
          );
        })}
        <th className="border border-slate-300 bg-slate-100" />
      </tr>
      <tr>
        <th className="sticky left-0 z-20 border border-slate-300 bg-slate-100 px-1 py-2 w-8" />
        <th className="sticky left-8 z-20 border border-slate-300 bg-slate-100 px-2 py-2 font-semibold">
          #
        </th>
        {COLUNAS.map((col) => (
          <th
            key={col.id}
            className={`border border-slate-300 px-2 py-2 text-left font-semibold whitespace-nowrap ${
              col.grupo === "documento"
                ? "bg-sky-50 text-sky-950"
                : col.grupo === "cadastro"
                  ? "bg-violet-50 text-violet-950"
                  : "bg-slate-100 text-slate-800"
            }`}
          >
            {col.titulo}
          </th>
        ))}
        <th className="border border-slate-300 bg-slate-100 px-2 py-2 font-semibold">PDF</th>
      </tr>
    </>
  );
}

function LinhaDocumentoTabela({
  row,
  onVerPdf,
  onCompararPdf,
  sublinhaSanfona = false,
}: {
  row: LinhaPlanilhaDocumento;
  onVerPdf: (linha: LinhaDocumento) => void;
  onCompararPdf?: (evento: ConsolidacaoEventoRow) => void;
  /** Linha dentro da sanfona expandida (só número do doc. na coluna #). */
  sublinhaSanfona?: boolean;
}) {
  const { evento, linha } = row;
  const rotuloNumero = sublinhaSanfona
    ? row.indiceDocumento || "—"
    : row.linha
      ? `${row.indiceEvento}.${row.indiceDocumento}`
      : String(row.indiceEvento);

  return (
    <tr className={sublinhaSanfona ? "bg-sky-50/40" : undefined}>
      <td className="sticky left-0 z-[5] border border-slate-200 bg-slate-50 px-1 py-1.5" />
      <td className="sticky left-8 z-[5] border border-slate-200 bg-slate-50 px-2 py-1.5 text-slate-600">
        {rotuloNumero}
      </td>
      {COLUNAS.map((col) => (
        <CelulaPlanilha key={col.id} valor={col.valor(row)} confianca={evento.confianca} />
      ))}
      <td className="border border-slate-200 bg-white px-2 py-1.5">
        <div className="flex flex-col items-start gap-1">
          {linha?.origemExtracao ? (
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={(e) => {
                e.stopPropagation();
                onVerPdf(linha);
              }}
            >
              Ver
            </button>
          ) : null}
          {!sublinhaSanfona &&
            row.evento.linhas.length >= 2 &&
            row.indiceDocumento === 1 &&
            onCompararPdf && (
              <button
                type="button"
                className="font-medium text-sky-700 underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompararPdf(row.evento);
                }}
              >
                Comparar PDFs
              </button>
            )}
        </div>
      </td>
    </tr>
  );
}

type Props = {
  eventos: ConsolidacaoEventoRow[];
  sessaoId?: string;
  onExportarCsv?: () => void;
  onMergeResolved?: () => void;
};

export function ConsolidacaoPlanilha({
  eventos,
  sessaoId,
  onExportarCsv,
  onMergeResolved,
}: Props) {
  const [modoSanfona, setModoSanfona] = useState(true);
  const [expandidos, setExpandidos] = useState<Set<string>>(() => new Set());
  const [pdfViewer, setPdfViewer] = useState<ViewerState | null>(null);
  const [comparadorLinha, setComparadorLinha] = useState<PlanilhaLinha | null>(null);

  const eventosOrdenados = useMemo(() => ordenarEventos(eventos), [eventos]);
  const linhasPlanilha = useMemo(() => expandirLinhasDocumento(eventos), [eventos]);

  const abrirPdf = (linha: LinhaDocumento) => {
    const o = linha.origemExtracao!;
    setPdfViewer({
      arquivoIngestaoId: o.arquivoIngestaoId,
      nomeArquivo: linha.nomeArquivo ?? o.nomeArquivo,
      pagina: o.pagina,
      bbox: o.bbox,
      highlightLabel: `${linha.papel} · ${linha.nomeArquivo ?? o.nomeArquivo}`,
      indiceLinha: o.indiceLinha,
    });
  };

  const abrirComparador = (evento: ConsolidacaoEventoRow) => {
    setComparadorLinha(planilhaLinhaFromEvento(evento));
  };

  const toggleEvento = (id: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (eventos.length === 0) {
    return (
      <p className="text-sm text-muted py-8 text-center">
        Nenhuma transação consolidada nesta sessão.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-700">Visualização:</span>
          <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
            <button
              type="button"
              className={`px-3 py-1.5 font-medium ${modoSanfona ? "bg-up-black text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              onClick={() => setModoSanfona(true)}
            >
              Sanfona
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 font-medium border-l border-slate-300 ${!modoSanfona ? "bg-up-black text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
              onClick={() => setModoSanfona(false)}
            >
              Lista plana
            </button>
          </div>
          {modoSanfona && (
            <>
              <button
                type="button"
                className="text-xs text-slate-600 underline hover:text-slate-900"
                onClick={() => setExpandidos(new Set(eventosOrdenados.map((e) => e.id)))}
              >
                Expandir todas
              </button>
              <button
                type="button"
                className="text-xs text-slate-600 underline hover:text-slate-900"
                onClick={() => setExpandidos(new Set())}
              >
                Recolher todas
              </button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-8 rounded border bg-white" /> vazio
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-8 rounded border bg-red-200" /> &lt;60%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-8 rounded border bg-amber-200" /> 60–84%
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-4 w-8 rounded border bg-emerald-300" /> ≥85%
          </span>
        </div>
        {onExportarCsv && (
          <button
            type="button"
            onClick={onExportarCsv}
            className="text-xs font-semibold text-up-black underline"
          >
            Exportar CSV
          </button>
        )}
      </div>

      <p className="text-xs text-slate-600">
        {modoSanfona
          ? "Modo sanfona: clique na transação para ver uma linha por documento PDF com todas as colunas."
          : "Lista plana: uma linha por documento, todas as transações visíveis."}
      </p>

      <div className="overflow-auto max-h-[min(70vh,900px)] rounded-lg border border-slate-300 shadow-sm">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-white">
            <CabecalhoGrupos />
          </thead>
          <tbody>
            {modoSanfona
              ? eventosOrdenados.map((evento, idx) => {
                  const aberto = expandidos.has(evento.id);
                  const indiceEvento = idx + 1;
                  const resumoRow: LinhaPlanilhaDocumento = {
                    evento,
                    linha: evento.linhas[0] ?? null,
                    indiceEvento,
                    indiceDocumento: 0,
                  };
                  const docRows = linhasDoEvento(evento, indiceEvento);
                  const nDocs = evento.linhas.length;

                  return (
                    <Fragment key={evento.id}>
                      <tr
                        className={`cursor-pointer select-none ${aberto ? "bg-slate-200/90" : "bg-slate-100 hover:bg-slate-200"}`}
                        onClick={() => toggleEvento(evento.id)}
                      >
                        <td className="sticky left-0 z-[5] border border-slate-300 bg-inherit px-1 py-2 text-center">
                          <span
                            className={`inline-block transition-transform ${aberto ? "rotate-90" : ""}`}
                          >
                            ▶
                          </span>
                        </td>
                        <td className="sticky left-8 z-[5] border border-slate-300 bg-inherit px-2 py-2 font-bold text-slate-800">
                          {indiceEvento}
                        </td>
                        {COLUNAS_EVENTO.map((col) => (
                          <CelulaPlanilha
                            key={col.id}
                            valor={col.valor(resumoRow)}
                            confianca={evento.confianca}
                            className="font-medium"
                          />
                        ))}
                        <td
                          colSpan={COLUNAS_DOCUMENTO.length}
                          className={`border border-slate-300 px-2 py-2 text-center font-medium text-sky-900 ${estiloConfiancaCelula(evento.confianca, true)}`}
                        >
                          {aberto
                            ? "▼ documentos abaixo"
                            : nDocs === 0
                              ? "Sem PDF — clique para abrir"
                              : `${nDocs} documento(s) — clique para expandir`}
                        </td>
                        {COLUNAS_CADASTRO.map((col) => (
                          <CelulaPlanilha
                            key={col.id}
                            valor={col.valor(resumoRow)}
                            confianca={evento.confianca}
                            className="font-medium"
                          />
                        ))}
                        <td className="border border-slate-300 bg-inherit px-2 py-2 text-center">
                          {nDocs >= 2 ? (
                            <button
                              type="button"
                              className="font-medium text-sky-700 underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                abrirComparador(evento);
                              }}
                            >
                              Comparar PDFs
                            </button>
                          ) : (
                            <span className="text-slate-400">{aberto ? "−" : "+"}</span>
                          )}
                        </td>
                      </tr>
                      {aberto &&
                        docRows.map((row) => (
                          <LinhaDocumentoTabela
                            key={row.linha?.id ?? `${evento.id}-vazio`}
                            row={row}
                            onVerPdf={abrirPdf}
                            onCompararPdf={abrirComparador}
                            sublinhaSanfona
                          />
                        ))}
                    </Fragment>
                  );
                })
              : linhasPlanilha.map((row) => (
                  <LinhaDocumentoTabela
                    key={row.linha ? `${row.evento.id}-${row.linha.id}` : `${row.evento.id}-vazio`}
                    row={{
                      ...row,
                      indiceEvento: row.indiceEvento,
                    }}
                    onVerPdf={abrirPdf}
                    onCompararPdf={abrirComparador}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {pdfViewer && (
        <PdfOrigemViewer
          open
          onClose={() => setPdfViewer(null)}
          arquivoIngestaoId={pdfViewer.arquivoIngestaoId}
          nomeArquivo={pdfViewer.nomeArquivo}
          pagina={pdfViewer.pagina}
          bbox={pdfViewer.bbox}
          highlightLabel={pdfViewer.highlightLabel}
          indiceLinha={pdfViewer.indiceLinha}
        />
      )}

      {comparadorLinha && sessaoId && (
        <PdfComparadorModal
          open
          onClose={() => setComparadorLinha(null)}
          linha={comparadorLinha}
          sessaoId={sessaoId}
          onMergeResolved={() => {
            setComparadorLinha(null);
            onMergeResolved?.();
          }}
        />
      )}
    </div>
  );
}

export function linhasCsvPlanilha(eventos: ConsolidacaoEventoRow[]): string[][] {
  const linhas = expandirLinhasDocumento(eventos);
  const header = ["Trans.", "Doc.", ...COLUNAS.map((c) => c.titulo)];
  const rows = linhas.map((row) => [
    String(row.indiceEvento),
    row.linha ? String(row.indiceDocumento) : "",
    ...COLUNAS.map((col) => col.valor(row) ?? ""),
  ]);
  return [header, ...rows];
}
