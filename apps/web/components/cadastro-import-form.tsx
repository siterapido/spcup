"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type ColumnMap = {
  documento: string;
  nome: string;
  tipo: string;
};

const EMPTY_MAP: ColumnMap = { documento: "", nome: "", tipo: "" };

export function CadastroImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<ColumnMap>(EMPTY_MAP);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadPreview(selected: File) {
    setPreviewLoading(true);
    setPreviewError(null);
    setResult(null);
    setHeaders([]);
    setColumnMap(EMPTY_MAP);

    try {
      const form = new FormData();
      form.set("file", selected);
      const res = await fetch("/api/pessoas/import/preview", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setPreviewError(json.error ?? "Falha ao ler colunas");
        return;
      }

      const nextHeaders = (json.headers as string[]) ?? [];
      const suggested = (json.suggestedMap as Partial<ColumnMap>) ?? {};
      setHeaders(nextHeaders);
      setColumnMap({
        documento: suggested.documento ?? "",
        nome: suggested.nome ?? "",
        tipo: suggested.tipo ?? "",
      });
    } catch {
      setPreviewError("Erro de rede ao ler colunas.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onFileChange(selected: File | null) {
    setFile(selected);
    if (selected) {
      await loadPreview(selected);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setResult("Selecione um arquivo.");
      return;
    }
    if (!columnMap.documento || !columnMap.nome) {
      setResult("Mapeie as colunas documento e nome.");
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set(
        "columnMap",
        JSON.stringify({
          documento: columnMap.documento,
          nome: columnMap.nome,
          ...(columnMap.tipo ? { tipo: columnMap.tipo } : {}),
        }),
      );
      const res = await fetch("/api/pessoas/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setResult(json.error ?? "Falha na importação");
        return;
      }
      setResult(
        `Inseridos: ${json.inseridos}, atualizados: ${json.atualizados}, ignorados: ${json.ignorados}, conflitos: ${json.conflitos}, erros: ${json.erros?.length ?? 0}`,
      );
    } catch {
      setResult("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }

  function updateMap(field: keyof ColumnMap, value: string) {
    setColumnMap((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-muted">
        Selecione a planilha e mapeie as colunas. Obrigatório: documento e nome. Tipo é opcional
        (infere PF/PJ pelo tamanho do documento).
      </p>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
        required
      />
      {previewLoading ? <p className="text-sm text-muted">Lendo colunas…</p> : null}
      {previewError ? <p className="text-sm text-red-600">{previewError}</p> : null}
      {headers.length > 0 ? (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm font-medium">Mapeamento de colunas</p>
          <label className="block text-sm">
            Documento (CPF/CNPJ)
            <select
              className="mt-1 block w-full max-w-md rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm"
              value={columnMap.documento}
              onChange={(e) => updateMap("documento", e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {headers.map((header) => (
                <option key={`doc-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Nome
            <select
              className="mt-1 block w-full max-w-md rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm"
              value={columnMap.nome}
              onChange={(e) => updateMap("nome", e.target.value)}
              required
            >
              <option value="">Selecione…</option>
              {headers.map((header) => (
                <option key={`nome-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Tipo (opcional)
            <select
              className="mt-1 block w-full max-w-md rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm"
              value={columnMap.tipo}
              onChange={(e) => updateMap("tipo", e.target.value)}
            >
              <option value="">Inferir pelo documento</option>
              {headers.map((header) => (
                <option key={`tipo-${header}`} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <Button type="submit" disabled={loading || previewLoading || headers.length === 0}>
        {loading ? "Importando…" : "Importar"}
      </Button>
      {result ? <p className="text-sm text-up-black">{result}</p> : null}
    </form>
  );
}
