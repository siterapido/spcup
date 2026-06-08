"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

type ColumnMap = {
  documento: string;
  nome: string;
  tipo: string;
};

const EMPTY_MAP: ColumnMap = { documento: "", nome: "", tipo: "" };

interface ImportResult {
  inseridos: number;
  atualizados: number;
  ignorados: number;
  conflitos: number;
  erros: Array<{ linha: number; motivo: string; nome?: string; documento?: string }>;
  inseridosList?: Array<{ linha: number; tipo: string; documento: string; nome: string }>;
}

export function CadastroImportForm({ defaultUf = "SP" }: { defaultUf?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uf, setUf] = useState(defaultUf.toUpperCase());
  const [headers, setHeaders] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<ColumnMap>(EMPTY_MAP);
  const [headerless, setHeaderless] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  async function loadPreview(selected: File) {
    setPreviewLoading(true);
    setPreviewError(null);
    setImportResult(null);
    setErrorMessage(null);
    setHeaders([]);
    setHeaderless(false);
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
      setHeaderless(Boolean(json.headerless));
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
      setErrorMessage("Selecione um arquivo.");
      setImportResult(null);
      return;
    }
    if (!columnMap.documento || !columnMap.nome) {
      setErrorMessage("Mapeie as colunas documento e nome.");
      setImportResult(null);
      return;
    }
    if (!uf || uf.length !== 2) {
      setErrorMessage("Selecione o estado (UF).");
      setImportResult(null);
      return;
    }

    setLoading(true);
    setImportResult(null);
    setErrorMessage(null);
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
      form.set("uf", uf.toUpperCase());
      const res = await fetch("/api/pessoas/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json.error ?? "Falha na importação");
        return;
      }
      setImportResult({
        inseridos: json.inseridos ?? 0,
        atualizados: json.atualizados ?? 0,
        ignorados: json.ignorados ?? 0,
        conflitos: json.conflitos ?? 0,
        erros: json.erros ?? [],
      });
    } catch {
      setErrorMessage("Erro de rede.");
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
      <label className="block text-sm">
        Estado (UF)
        <select
          className="mt-1 block w-full max-w-[8rem] rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm"
          value={uf}
          onChange={(e) => setUf(e.target.value.toUpperCase())}
          required
        >
          {UFS.map((sigla) => (
            <option key={sigla} value={sigla}>
              {sigla}
            </option>
          ))}
        </select>
      </label>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => void onFileChange(e.target.files?.[0] ?? null)}
        required
      />
      {previewLoading ? <p className="text-sm text-muted">Lendo colunas…</p> : null}
      {previewError ? <p className="text-sm text-red-600">{previewError}</p> : null}
      {headerless ? (
        <p className="text-sm text-muted">
          Planilha sem linha de cabeçalho detectada (layout nome | documento ou documento |
          nome). Mapeamento sugerido já aplicado — confira e importe.
        </p>
      ) : null}
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
      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {importResult ? (
        <div className="space-y-4">
          <p className="text-sm text-up-black">
            Inseridos: {importResult.inseridos}, atualizados: {importResult.atualizados},
            ignorados: {importResult.ignorados}, conflitos: {importResult.conflitos}, erros:{" "}
            {importResult.erros.length}
          </p>

          {importResult.inseridosList && importResult.inseridosList.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-700">Cadastros inseridos com sucesso:</p>
              <Table>
                <thead>
                  <tr>
                    <Th>Linha</Th>
                    <Th>Tipo</Th>
                    <Th>Documento</Th>
                    <Th>Nome</Th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.inseridosList.map((item) => (
                    <tr key={`${item.tipo}-${item.documento}`}>
                      <Td>{item.linha}</Td>
                      <Td>{item.tipo}</Td>
                      <Td>{item.documento}</Td>
                      <Td>{item.nome}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}

          {importResult.erros.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-red-700">Erros / Falhas:</p>
              <Table>
                <thead>
                  <tr>
                    <Th>Linha</Th>
                    <Th>Nome</Th>
                    <Th>Documento</Th>
                    <Th>Motivo</Th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.erros.map((erro) => (
                    <tr key={`${erro.linha}-${erro.motivo}-${erro.documento}`}>
                      <Td>{erro.linha}</Td>
                      <Td>{erro.nome ?? "—"}</Td>
                      <Td>{erro.documento ?? "—"}</Td>
                      <Td className="text-red-600">{erro.motivo}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
