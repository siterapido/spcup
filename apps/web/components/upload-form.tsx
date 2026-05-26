"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function UploadForm({
  defaultUf,
  defaultExercicio,
}: {
  defaultUf: string;
  defaultExercicio: number;
}) {
  const router = useRouter();
  const [uf, setUf] = useState(defaultUf);
  const [exercicio, setExercicio] = useState(String(defaultExercicio));
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("uf", uf.toUpperCase());
    data.set("exercicio", exercicio);

    try {
      const res = await fetch("/api/upload", { method: "POST", body: data });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Falha no upload");
        return;
      }
      setMessage(`${json.movimentacoes_criadas} movimentação(ões) criada(s).`);
      router.refresh();
    } catch {
      setMessage("Erro de rede ao enviar arquivo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">UF</span>
          <Input
            name="uf"
            maxLength={2}
            required
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            className="mt-1"
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Exercício</span>
          <Input
            name="exercicio"
            type="number"
            required
            value={exercicio}
            onChange={(e) => setExercicio(e.target.value)}
            className="mt-1"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Arquivo (OFX / Excel / PDF)</span>
        <Input
          name="file"
          type="file"
          required
          accept=".ofx,.xlsx,.xls,.pdf"
          className="mt-1"
        />
      </label>
      <Button type="submit" disabled={loading}>
        {loading ? "Enviando…" : "Enviar"}
      </Button>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
    </form>
  );
}
