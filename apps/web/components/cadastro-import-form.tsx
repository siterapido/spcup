"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CadastroImportForm({
  defaultUf = "SP",
  defaultExercicio = 2025,
}: {
  defaultUf?: string;
  defaultExercicio?: number;
}) {
  const [uf, setUf] = useState(defaultUf);
  const [exercicio, setExercicio] = useState(String(defaultExercicio));
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setResult("Selecione um arquivo.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("uf", uf.toUpperCase());
      form.set("exercicio", exercicio);
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

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-slate-600">
        Planilha com colunas: <code>tipo</code>, <code>documento</code>, <code>nome</code> (CSV ou Excel).
      </p>
      <input
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          UF
          <Input className="mt-1 w-20" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value)} />
        </label>
        <label className="text-sm">
          Exercício
          <Input className="mt-1 w-28" type="number" value={exercicio} onChange={(e) => setExercicio(e.target.value)} />
        </label>
      </div>
      <Button type="submit" disabled={loading}>
        {loading ? "Importando…" : "Importar"}
      </Button>
      {result ? <p className="text-sm text-slate-700">{result}</p> : null}
    </form>
  );
}
