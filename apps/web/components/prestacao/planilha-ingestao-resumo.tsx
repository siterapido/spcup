"use client";

import { useEffect, useMemo, useState } from "react";

import {
  ARQUIVO_INGESTAO_STATUS,
  type IngestaoResumo,
  type IngestaoResumoArquivo,
} from "@spc-up/core/browser";

import { PdfOrigemViewer } from "@/components/prestacao/pdf-origem-viewer";
import { Badge } from "@/components/ui/badge";

type PdfTarget = {
  arquivoId: string;
  nomeArquivo: string;
  pagina: number;
};

type Props = {
  sessaoId: string;
  ingestaoResumo: IngestaoResumo;
};

function countAlertas(resumo: IngestaoResumo): number {
  let n = 0;
  for (const arq of resumo.arquivos) {
    n += arq.paginasVerificar;
    n += arq.linhasIgnoradasSemDoc;
    n += arq.avisosBalance?.length ?? 0;
    if (arq.status === ARQUIVO_INGESTAO_STATUS.ERRO) n += 1;
  }
  return n;
}

function mergesPorArquivo(arq: IngestaoResumoArquivo): number | null {
  if (arq.linhasPlanilha <= 0) return null;
  const diff = arq.movimentacoesExtraidas - arq.linhasPlanilha;
  return diff > 0 ? diff : null;
}

function arquivoHeader(arq: IngestaoResumoArquivo): string {
  const parts = [
    `${arq.nomeArquivo} · ${arq.movimentacoesExtraidas} extraídas`,
  ];
  if (arq.linhasPlanilha > 0) {
    parts.push(`→ ${arq.linhasPlanilha} linhas`);
    const merges = mergesPorArquivo(arq);
    if (merges != null) parts.push(`· ${merges} merges`);
  }
  if (arq.paginasVerificar > 0) {
    parts.push(
      `· ${arq.paginasVerificar} pág. verificar`,
    );
  }
  if (arq.linhasIgnoradasSemDoc > 0) {
    parts.push(`· ${arq.linhasIgnoradasSemDoc} duplicadas`);
  }
  const avisosSaldo = arq.avisosBalance?.length ?? 0;
  if (avisosSaldo > 0) {
    parts.push(`· ${avisosSaldo} aviso(s) saldo`);
  }
  if (arq.status === ARQUIVO_INGESTAO_STATUS.ERRO) {
    parts.push("· erro");
  }
  return parts.join(" ");
}

function truncateMotivo(motivo: string | null | undefined, max = 80): string {
  if (!motivo) return "—";
  return motivo.length > max ? `${motivo.slice(0, max)}…` : motivo;
}

export function PlanilhaIngestaoResumo({ ingestaoResumo }: Props) {
  const alertas = useMemo(() => countAlertas(ingestaoResumo), [ingestaoResumo]);
  const [open, setOpen] = useState(false);
  const [expandedArquivo, setExpandedArquivo] = useState<string | null>(null);
  const [pdfTarget, setPdfTarget] = useState<PdfTarget | null>(null);

  useEffect(() => {
    if (alertas > 0) setOpen(true);
  }, [alertas]);

  if (ingestaoResumo.arquivos.length === 0) return null;

  return (
    <div className="rounded-md border border-border-default bg-slate-50/80">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-800 hover:bg-slate-100/80"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          Resumo da extração
          {alertas > 0 ? (
            <Badge tone="danger" className="tabular-nums">
              {alertas}
            </Badge>
          ) : null}
        </span>
        <span className="text-xs text-muted">{open ? "Ocultar" : "Mostrar"}</span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-border-default px-4 py-3">
          <p className="text-sm text-slate-700">
            <span className="font-medium tabular-nums">
              {ingestaoResumo.movimentacoesBrutas}
            </span>{" "}
            movimentações brutas →{" "}
            <span className="font-medium tabular-nums">
              {ingestaoResumo.linhasPlanilha}
            </span>{" "}
            linhas na planilha ·{" "}
            <span className="font-medium tabular-nums">
              {ingestaoResumo.mergesPendentes}
            </span>{" "}
            merges pendentes
          </p>

          <div className="space-y-2">
            {ingestaoResumo.arquivos.map((arq) => {
              const isExpanded = expandedArquivo === arq.id;
              return (
                <div
                  key={arq.id}
                  className="overflow-hidden rounded-md border border-border-default bg-white"
                >
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-50"
                    onClick={() =>
                      setExpandedArquivo(isExpanded ? null : arq.id)
                    }
                    aria-expanded={isExpanded}
                  >
                    <span className="font-medium">{arquivoHeader(arq)}</span>
                    <span className="shrink-0 text-muted">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>

                  {isExpanded && (arq.avisosBalance?.length ?? 0) > 0 ? (
                    <ul className="space-y-1 border-t border-border-default px-3 py-2 text-xs text-amber-800">
                      {arq.avisosBalance!.map((aviso, idx) => (
                        <li key={idx}>{aviso}</li>
                      ))}
                    </ul>
                  ) : null}

                  {isExpanded && arq.paginas.length > 0 ? (
                    <div className="overflow-x-auto border-t border-border-default">
                      <table className="w-full min-w-[32rem] text-left text-xs">
                        <thead className="bg-slate-50 text-muted">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Página</th>
                            <th className="px-3 py-1.5 font-medium">Status</th>
                            <th className="px-3 py-1.5 font-medium">Aceitas</th>
                            <th className="px-3 py-1.5 font-medium">Incertas</th>
                            <th className="px-3 py-1.5 font-medium">Motivo</th>
                            <th className="px-3 py-1.5 font-medium" />
                          </tr>
                        </thead>
                        <tbody>
                          {arq.paginas.map((pag) => (
                            <tr
                              key={pag.pagina}
                              className="border-t border-slate-100"
                            >
                              <td className="px-3 py-1.5 tabular-nums">
                                {pag.pagina}
                              </td>
                              <td className="px-3 py-1.5">{pag.status}</td>
                              <td className="px-3 py-1.5 tabular-nums">
                                {pag.aceitas}
                              </td>
                              <td className="px-3 py-1.5 tabular-nums">
                                {pag.incertas}
                              </td>
                              <td
                                className="max-w-[14rem] truncate px-3 py-1.5 text-muted"
                                title={pag.motivo ?? undefined}
                              >
                                {truncateMotivo(pag.motivo)}
                              </td>
                              <td className="px-3 py-1.5">
                                {pag.status === "VERIFICAR" ? (
                                  <button
                                    type="button"
                                    className="text-primary underline"
                                    onClick={() =>
                                      setPdfTarget({
                                        arquivoId: arq.id,
                                        nomeArquivo: arq.nomeArquivo,
                                        pagina: pag.pagina,
                                      })
                                    }
                                  >
                                    Ver PDF
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : isExpanded ? (
                    <p className="border-t border-border-default px-3 py-2 text-xs text-muted">
                      Nenhuma página detalhada registrada para este arquivo.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {pdfTarget ? (
        <PdfOrigemViewer
          open
          onClose={() => setPdfTarget(null)}
          arquivoIngestaoId={pdfTarget.arquivoId}
          nomeArquivo={pdfTarget.nomeArquivo}
          pagina={pdfTarget.pagina}
          highlightLabel={`Página ${pdfTarget.pagina} · verificar`}
        />
      ) : null}
    </div>
  );
}
