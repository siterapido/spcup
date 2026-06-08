"use client";

import {
  type ExtratoColumnMap,
  type ExtratoColumnMapEntry,
} from "@spc-up/core/extrato-column-map";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  boundsForColumnIndex,
  boundsFromClickNorm,
  clamp01,
  resolveColumnFromTextItems,
  autoDiscoverColumns,
  detectColunaDirecaoNoCabecalho,
  type TextItemLike,
} from "@/lib/extrato-column-map-client";
import { borderForCampo, colorForCampo } from "@/lib/extrato-column-colors";
import { loadPdfJs } from "@/lib/pdfjs-browser";

/** Ordem e rótulos exibidos no wizard (sem `direcao` quando inferir do valor). */
const UI_CAMPOS = [
  "data",
  "valor",
  "documento",
  "cpf_cnpj",
  "nome",
  "historico",
  "saldo",
  "tipo_pix",
  "situacao",
  "hora",
] as const;

const CAMPOS_OBRIGATORIOS_POR_PDF = new Set(["data", "valor"]);
const CAMPOS_OBRIGATORIOS_SESSAO = new Set(["nome", "historico", "documento"]);

const CAMPOS_OPCIONAIS = new Set(["cpf_cnpj", "saldo", "tipo_pix", "situacao", "hora"]);

const CAMPO_LABELS: Record<string, string> = {
  data: "Data",
  valor: "Valor",
  direcao: "Direção (D/C)",
  documento: "Documento (nº lançamento)",
  cpf_cnpj: "CPF/CNPJ",
  nome: "Nome",
  historico: "Histórico",
  saldo: "Saldo",
  tipo_pix: "Tipo de PIX",
  situacao: "Situação",
  cred_dev: "Cred/Dev",
  hora: "Hora",
};

function entryBounds(
  entry: ExtratoColumnMapEntry,
  columnCount: number,
): { xInicio: number; xFim: number } {
  if (entry.xInicio != null && entry.xFim != null && entry.xFim > entry.xInicio) {
    return { xInicio: entry.xInicio, xFim: entry.xFim };
  }
  return boundsForColumnIndex(entry.colunaIndex, columnCount);
}

export type ExtratoColumnMapPanelProps = {
  file: File;
  map: ExtratoColumnMap | undefined;
  selectedCampo: string;
  customCampos: string[];
  customLabels: Record<string, string>;
  inferirDirecao: boolean;
  colunaDirecaoDetectada?: boolean;
  onInferirDirecaoChange: (value: boolean) => void;
  onDirecaoDetectadaChange?: (detected: boolean) => void;
  onSelectCampo: (campo: string) => void;
  onAssign: (entry: ExtratoColumnMapEntry) => void;
  onAssignMultiple?: (entries: ExtratoColumnMapEntry[]) => void;
  onClearColumn: (campo: string) => void;
  onAddCustomField: (label: string) => void;
  sessionCoverage?: Record<string, { fileName: string }>;
  onColumnCountChange?: (count: number) => void;
};

export function ExtratoColumnMapPanel({
  file,
  map,
  selectedCampo,
  customCampos,
  customLabels,
  inferirDirecao,
  colunaDirecaoDetectada = false,
  onInferirDirecaoChange,
  onDirecaoDetectadaChange,
  onSelectCampo,
  onAssign,
  onAssignMultiple,
  onClearColumn,
  onAddCustomField,
  sessionCoverage = {},
  onColumnCountChange,
}: ExtratoColumnMapPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textItems, setTextItems] = useState<TextItemLike[]>([]);
  const [columnCount, setColumnCount] = useState(8);
  const [customInput, setCustomInput] = useState("");
  const [drag, setDrag] = useState<null | { campo: string; edge: "left" | "right" }>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await loadPdfJs();
        const data = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }

        const viewport = page.getViewport({ scale: 1.25 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          return;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;

        const textContent = await page.getTextContent();
        const items: TextItemLike[] = [];
        for (const item of textContent.items) {
          if (!("str" in item)) {
            continue;
          }
          items.push({ str: item.str, transform: [...item.transform] });
        }
        if (!cancelled) {
          setTextItems(items);
          const clusters = new Set(
            items.map((item) => Math.round((item.transform[4] ?? 0) / 40)),
          );
          setColumnCount(Math.max(3, Math.min(16, clusters.size || 8)));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Erro ao carregar PDF");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => {
    if (loading || textItems.length === 0 || !onAssignMultiple || !canvasRef.current) {
      return;
    }
    if (map && map.colunas && map.colunas.length > 0) {
      return;
    }
    const discovered = autoDiscoverColumns(textItems, canvasRef.current.width);
    if (discovered.length > 0) {
      onAssignMultiple(discovered);
    }
  }, [textItems, loading, map, onAssignMultiple]);

  useEffect(() => {
    if (loading || textItems.length === 0 || !onDirecaoDetectadaChange) {
      return;
    }
    onDirecaoDetectadaChange(detectColunaDirecaoNoCabecalho(textItems));
  }, [textItems, loading, onDirecaoDetectadaChange]);

  useEffect(() => {
    onColumnCountChange?.(columnCount);
  }, [columnCount, onColumnCountChange]);

  const assignManual = useCallback(
    (campo: string, colunaIndex: number) => {
      const { xInicio, xFim } = boundsForColumnIndex(colunaIndex, columnCount);
      onAssign({
        campo,
        colunaIndex,
        xInicio,
        xFim,
        label: customLabels[campo],
      });
    },
    [columnCount, customLabels, onAssign],
  );

  const onCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clickX = (event.clientX - rect.left) * scaleX;
      const clickY = (event.clientY - rect.top) * scaleY;
      const clickXNorm = clickX / canvas.width;

      let colunaIndex: number;
      let headerLabel: string | undefined;
      let xInicio: number;
      let xFim: number;

      if (textItems.length > 0) {
        const resolved = resolveColumnFromTextItems(textItems, clickX, clickY);
        colunaIndex = resolved.colunaIndex;
        headerLabel = resolved.headerLabel;
        const band = boundsFromClickNorm(clickXNorm, columnCount);
        xInicio = band.xInicio;
        xFim = band.xFim;
      } else {
        const band = boundsFromClickNorm(clickXNorm, columnCount);
        colunaIndex = band.colunaIndex;
        xInicio = band.xInicio;
        xFim = band.xFim;
      }

      onAssign({
        campo: selectedCampo,
        colunaIndex,
        headerLabel,
        xInicio,
        xFim,
        label: customLabels[selectedCampo],
      });
    },
    [columnCount, customLabels, onAssign, selectedCampo, textItems],
  );

  useEffect(() => {
    if (!drag) {
      return;
    }

    const onMove = (ev: MouseEvent) => {
      const overlay = overlayRef.current;
      const mapped = map?.colunas.find((c) => c.campo === drag.campo);
      if (!overlay || !mapped) {
        return;
      }
      const rect = overlay.getBoundingClientRect();
      const xNorm = clamp01((ev.clientX - rect.left) / rect.width);
      const current = entryBounds(mapped, columnCount);
      if (drag.edge === "left") {
        onAssign({
          ...mapped,
          xInicio: Math.min(xNorm, current.xFim - 0.02),
          xFim: current.xFim,
        });
      } else {
        onAssign({
          ...mapped,
          xInicio: current.xInicio,
          xFim: Math.max(xNorm, current.xInicio + 0.02),
        });
      }
    };

    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [columnCount, drag, map?.colunas, onAssign]);

  const mappedByCampo = new Map(map?.colunas.map((c) => [c.campo, c]));
  const campos = useMemo(() => {
    const base: string[] = colunaDirecaoDetectada
      ? ["data", "valor", "direcao", "documento", "cpf_cnpj", "nome", "historico", "saldo", "tipo_pix", "situacao", "hora"]
      : [...UI_CAMPOS];
    return [...base, ...customCampos.filter((c) => !base.includes(c))];
  }, [colunaDirecaoDetectada, customCampos]);

  return (
    <div className="grid min-h-[480px] gap-4 lg:grid-cols-2">
      <div className="min-h-0 space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Página 1 — faixas coloridas por campo
        </p>
        <p className="text-xs text-muted">
          Escolha o campo à direita, ajuste a coluna no seletor ou arraste as bordas da faixa.
          Clique no PDF para posicionar o campo selecionado.
        </p>
        <div className="overflow-auto rounded-md border border-border-default bg-muted/20">
          {loading ? (
            <p className="p-4 text-sm text-muted">Carregando prévia…</p>
          ) : null}
          {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
          <div className="relative inline-block max-w-full">
            <canvas
              ref={canvasRef}
              className="block max-w-full cursor-crosshair"
              onClick={onCanvasClick}
              role="img"
              aria-label={`Prévia de ${file.name}`}
            />
            {!loading && !error && map?.colunas.length ? (
              <div ref={overlayRef} className="absolute inset-0" aria-hidden>
                {map.colunas.map((entry, idx) => {
                  const { xInicio, xFim } = entryBounds(entry, columnCount);
                  const isActive = entry.campo === selectedCampo;
                  const label =
                    CAMPO_LABELS[entry.campo] ?? customLabels[entry.campo] ?? entry.campo;
                  return (
                    <div
                      key={entry.campo}
                      role="button"
                      tabIndex={0}
                      className="absolute top-0 bottom-0 cursor-pointer"
                      style={{
                        left: `${xInicio * 100}%`,
                        width: `${(xFim - xInicio) * 100}%`,
                        backgroundColor: colorForCampo(entry.campo, idx),
                        borderLeft: `2px solid ${borderForCampo(entry.campo, idx)}`,
                        borderRight: `2px solid ${borderForCampo(entry.campo, idx)}`,
                        opacity: isActive ? 1 : 0.5,
                        zIndex: isActive ? 10 : 1,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCampo(entry.campo);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          onSelectCampo(entry.campo);
                        }
                      }}
                    >
                      <span
                        className="absolute left-0 top-0 max-w-full truncate bg-black/60 px-1 text-[10px] font-medium text-white"
                        style={{ transform: "translateY(-100%)" }}
                      >
                        {label}
                      </span>
                      {isActive ? (
                        <>
                          <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-black/25"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDrag({ campo: entry.campo, edge: "left" });
                            }}
                          />
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-black/25"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDrag({ campo: entry.campo, edge: "right" });
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Campos do extrato</p>

        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Colunas na tabela:</span>
          <input
            type="number"
            min={3}
            max={16}
            className="w-16 rounded-md border border-border-input px-2 py-1 text-sm"
            value={columnCount}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(n) && n >= 3 && n <= 16) {
                setColumnCount(n);
              }
            }}
          />
        </label>

        {colunaDirecaoDetectada ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Coluna D/C detectada no cabeçalho. Mapeie o campo Direção (D/C) abaixo.
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inferirDirecao}
            disabled={colunaDirecaoDetectada}
            onChange={(e) => onInferirDirecaoChange(e.target.checked)}
          />
          Inferir entrada/saída pela coluna valor
        </label>

        <ul className="max-h-[min(50vh,420px)] space-y-2 overflow-auto rounded-md border border-border-default p-2">
          {campos.map((campo, idx) => {
            const mapped = mappedByCampo.get(campo);
            const label = CAMPO_LABELS[campo] ?? customLabels[campo] ?? campo;
            const isSelected = selectedCampo === campo;
            return (
              <li
                key={campo}
                className={`rounded-md border p-2 ${
                  isSelected ? "border-up-black/40 bg-up-black/5" : "border-transparent"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    onClick={() => onSelectCampo(campo)}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm border border-black/20"
                      style={{ backgroundColor: colorForCampo(campo, idx) }}
                      aria-hidden
                    />
                    <span className="font-medium">{label}</span>
                    {CAMPOS_OBRIGATORIOS_POR_PDF.has(campo) ||
                    (campo === "direcao" && colunaDirecaoDetectada) ||
                    (CAMPOS_OBRIGATORIOS_SESSAO.has(campo) &&
                      !mapped &&
                      !sessionCoverage[campo]) ? (
                      <span className="text-xs font-medium text-red-600" title="Obrigatório">
                        *
                      </span>
                    ) : null}
                    {CAMPOS_OBRIGATORIOS_SESSAO.has(campo) &&
                    !mapped &&
                    sessionCoverage[campo] ? (
                      <span
                        className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900"
                        title={`Mapeado em ${sessionCoverage[campo]!.fileName}`}
                      >
                        Outro extrato
                      </span>
                    ) : null}
                    {CAMPOS_OPCIONAIS.has(campo) ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                        opcional
                      </span>
                    ) : null}
                  </button>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    Coluna
                    <select
                      className="rounded border border-border-input bg-surface-card px-2 py-1 text-sm text-up-black"
                      value={mapped != null ? String(mapped.colunaIndex) : ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "") {
                          onClearColumn(campo);
                          return;
                        }
                        assignManual(campo, Number.parseInt(v, 10));
                      }}
                    >
                      <option value="">—</option>
                      {Array.from({ length: columnCount }, (_, i) => (
                        <option key={i} value={i}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  {mapped ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() => onClearColumn(campo)}
                    >
                      Limpar
                    </Button>
                  ) : null}
                </div>
                {mapped?.headerLabel ? (
                  <p className="mt-1 pl-5 text-xs text-muted">Cabeçalho: {mapped.headerLabel}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 rounded-md border border-border-input px-2 py-1.5 text-sm"
            placeholder="Nome do campo extra"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onAddCustomField(customInput);
              setCustomInput("");
            }}
          >
            Adicionar
          </Button>
        </div>
      </div>
    </div>
  );
}
