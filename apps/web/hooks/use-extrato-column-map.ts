"use client";

import {
  EXTRATO_SESSION_REQUIRED_CAMPOS,
  extratoColumnMapHasCampo,
  slugCustomField,
  validateExtratoColumnMapPerPdf,
  validateExtratoColumnMapsSession,
  type ExtratoColumnMap,
  type ExtratoColumnMapEntry,
} from "@spc-up/core/extrato-column-map";
import { useCallback, useEffect, useMemo, useState } from "react";

import { clientFileKey } from "@/lib/extrato-column-map-client";

export function useExtratoColumnMap(files: File[]) {
  const pdfFiles = useMemo(
    () => files.filter((f) => f.name.toLowerCase().endsWith(".pdf")),
    [files],
  );

  const [maps, setMaps] = useState<Record<string, ExtratoColumnMap>>({});
  const [columnCounts, setColumnCounts] = useState<Record<string, number>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedCampo, setSelectedCampo] = useState<string>("data");
  const [inferirDirecao, setInferirDirecao] = useState(true);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (pdfFiles.length === 0) {
      setActiveKey(null);
      return;
    }
    const firstKey = clientFileKey(pdfFiles[0]!);
    setActiveKey((prev) => {
      if (prev != null && pdfFiles.some((f) => clientFileKey(f) === prev)) {
        return prev;
      }
      return firstKey;
    });
  }, [pdfFiles]);

  const activeFile =
    pdfFiles.find((f) => clientFileKey(f) === activeKey) ?? pdfFiles[0] ?? null;
  const activeMap = activeFile ? maps[clientFileKey(activeFile)] : undefined;

  const customCampos = useMemo(() => {
    const keys = new Set<string>();
    for (const map of Object.values(maps)) {
      for (const col of map.colunas) {
        if (col.campo.startsWith("custom_")) {
          keys.add(col.campo);
        }
      }
    }
    return [...keys];
  }, [maps]);

  const mapFlagsForFile = useCallback(
    (
      current: ExtratoColumnMap | undefined,
      colunaDirecaoDetectada: boolean,
    ): Pick<ExtratoColumnMap, "inferirDirecaoDoValor" | "colunaDirecaoDetectada"> => {
      if (colunaDirecaoDetectada) {
        return { colunaDirecaoDetectada: true, inferirDirecaoDoValor: false };
      }
      return {
        colunaDirecaoDetectada: current?.colunaDirecaoDetectada,
        inferirDirecaoDoValor: inferirDirecao,
      };
    },
    [inferirDirecao],
  );

  const assignColumn = useCallback(
    (entry: ExtratoColumnMapEntry) => {
      if (!activeFile) {
        return;
      }
      const key = clientFileKey(activeFile);
      setMaps((prev) => {
        const current = prev[key] ?? { paginaReferencia: 1, colunas: [] };
        const colunas = current.colunas.filter((c) => c.campo !== entry.campo);
        colunas.push(entry);
        const colunaDirecaoDetectada =
          current.colunaDirecaoDetectada === true || entry.campo === "direcao";
        return {
          ...prev,
          [key]: {
            paginaReferencia: 1,
            ...mapFlagsForFile(current, colunaDirecaoDetectada),
            colunas,
          },
        };
      });
    },
    [activeFile, mapFlagsForFile],
  );

  const assignMultipleColumns = useCallback(
    (entries: ExtratoColumnMapEntry[]) => {
      if (!activeFile) {
        return;
      }
      const key = clientFileKey(activeFile);
      setMaps((prev) => {
        const current = prev[key] ?? { paginaReferencia: 1, colunas: [] };
        const entryFields = new Set(entries.map((e) => e.campo));
        const colunas = current.colunas.filter((c) => !entryFields.has(c.campo));
        colunas.push(...entries);
        const colunaDirecaoDetectada =
          current.colunaDirecaoDetectada === true ||
          entries.some((e) => e.campo === "direcao");
        if (colunaDirecaoDetectada) {
          setInferirDirecao(false);
        }
        return {
          ...prev,
          [key]: {
            paginaReferencia: 1,
            ...mapFlagsForFile(current, colunaDirecaoDetectada),
            colunas,
          },
        };
      });
    },
    [activeFile, mapFlagsForFile],
  );

  const clearColumn = useCallback(
    (campo: string) => {
      if (!activeFile) {
        return;
      }
      const key = clientFileKey(activeFile);
      setMaps((prev) => {
        const current = prev[key];
        if (!current) {
          return prev;
        }
        return {
          ...prev,
          [key]: {
            ...current,
            colunas: current.colunas.filter((c) => c.campo !== campo),
          },
        };
      });
    },
    [activeFile],
  );

  const addCustomField = useCallback((label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    const campo = slugCustomField(trimmed);
    setCustomLabels((prev) => ({ ...prev, [campo]: trimmed }));
    setSelectedCampo(campo);
  }, []);

  const setDirecaoDetectada = useCallback(
    (detected: boolean) => {
      if (!activeFile) {
        return;
      }
      const key = clientFileKey(activeFile);
      if (detected) {
        setInferirDirecao(false);
      }
      setMaps((prev) => {
        const current = prev[key] ?? { paginaReferencia: 1, colunas: [] };
        return {
          ...prev,
          [key]: {
            ...current,
            ...mapFlagsForFile(current, detected),
          },
        };
      });
    },
    [activeFile, mapFlagsForFile],
  );

  const syncInferirDirecao = useCallback(
    (value: boolean) => {
      if (!activeFile) {
        setInferirDirecao(value);
        return;
      }
      const key = clientFileKey(activeFile);
      const current = maps[key];
      if (current?.colunaDirecaoDetectada === true) {
        setInferirDirecao(false);
        setMaps((prev) => {
          const m = prev[key];
          if (!m) {
            return prev;
          }
          return {
            ...prev,
            [key]: { ...m, inferirDirecaoDoValor: false, colunaDirecaoDetectada: true },
          };
        });
        return;
      }
      setInferirDirecao(value);
      setMaps((prev) => {
        const m = prev[key];
        if (!m) {
          return prev;
        }
        return {
          ...prev,
          [key]: { ...m, inferirDirecaoDoValor: value },
        };
      });
    },
    [activeFile, maps],
  );

  const setColumnCountForActiveFile = useCallback(
    (count: number) => {
      if (!activeFile) {
        return;
      }
      const key = clientFileKey(activeFile);
      setColumnCounts((prev) => ({ ...prev, [key]: count }));
    },
    [activeFile],
  );

  const sessionCoverageForActive = useMemo(() => {
    if (!activeFile) {
      return {} as Record<string, { fileName: string }>;
    }
    const activeFileKey = clientFileKey(activeFile);
    const coverage: Record<string, { fileName: string }> = {};
    for (const campo of EXTRATO_SESSION_REQUIRED_CAMPOS) {
      for (const f of pdfFiles) {
        const key = clientFileKey(f);
        if (key === activeFileKey) {
          continue;
        }
        const m = maps[key];
        if (m && extratoColumnMapHasCampo(m, campo)) {
          coverage[campo] = { fileName: f.name };
          break;
        }
      }
    }
    return coverage;
  }, [activeFile, pdfFiles, maps]);

  const validationError = useMemo(() => {
    for (const f of pdfFiles) {
      const m = maps[clientFileKey(f)];
      if (!m) {
        return `${f.name}: mapeamento pendente`;
      }
      const res = validateExtratoColumnMapPerPdf(m);
      if (!res.ok) {
        return `${f.name}: ${res.message}`;
      }
    }
    const sessionMaps = pdfFiles
      .map((f) => maps[clientFileKey(f)])
      .filter((m): m is ExtratoColumnMap => m != null);
    const sessionRes = validateExtratoColumnMapsSession(sessionMaps);
    if (!sessionRes.ok) {
      return sessionRes.message;
    }
    return null;
  }, [pdfFiles, maps]);

  const allMapped = useMemo(() => {
    if (pdfFiles.length === 0) {
      return true;
    }
    return validationError == null;
  }, [pdfFiles.length, validationError]);

  const activeMapPerPdfValid = useMemo(() => {
    if (!activeMap) {
      return false;
    }
    return validateExtratoColumnMapPerPdf(activeMap).ok;
  }, [activeMap]);

  const canCopyMapToOtherPdfs = useMemo(() => {
    if (!activeFile || !activeMapPerPdfValid || pdfFiles.length < 2) {
      return false;
    }
    const activeCount = columnCounts[clientFileKey(activeFile)];
    if (activeCount == null) {
      return false;
    }
    for (const f of pdfFiles) {
      const count = columnCounts[clientFileKey(f)];
      if (count == null || count !== activeCount) {
        return false;
      }
    }
    return true;
  }, [activeFile, activeMapPerPdfValid, columnCounts, pdfFiles]);

  const copyMapToOtherPdfs = useCallback(() => {
    if (!activeFile || !activeMap || !canCopyMapToOtherPdfs) {
      return;
    }
    const sourceKey = clientFileKey(activeFile);
    const sourceMap = structuredClone(activeMap);
    setMaps((prev) => {
      const next = { ...prev };
      for (const f of pdfFiles) {
        const key = clientFileKey(f);
        if (key !== sourceKey) {
          next[key] = structuredClone(sourceMap);
        }
      }
      return next;
    });
  }, [activeFile, activeMap, canCopyMapToOtherPdfs, pdfFiles]);

  return {
    pdfFiles,
    maps,
    activeFile,
    activeKey: activeFile ? clientFileKey(activeFile) : null,
    setActiveKey,
    activeMap,
    selectedCampo,
    setSelectedCampo,
    inferirDirecao,
    setInferirDirecao: syncInferirDirecao,
    setDirecaoDetectada,
    colunaDirecaoDetectada: activeMap?.colunaDirecaoDetectada === true,
    assignColumn,
    assignMultipleColumns,
    clearColumn,
    addCustomField,
    customCampos,
    customLabels,
    allMapped,
    activeMapPerPdfValid,
    canCopyMapToOtherPdfs,
    sessionCoverageForActive,
    setColumnCountForActiveFile,
    validationError,
    copyMapToOtherPdfs,
  };
}
