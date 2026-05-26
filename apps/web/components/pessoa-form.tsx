"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDocumentoInput } from "@/lib/format-document";
import { validateDocumentoInput } from "@/lib/validate-document";

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function PessoaForm({
  defaultUf = "SP",
  defaultExercicio = 2025,
  retornoUrl,
}: {
  defaultUf?: string;
  defaultExercicio?: number;
  retornoUrl?: string | null;
}) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"PF" | "PJ">("PF");
  const [documento, setDocumento] = useState("");
  const [nome, setNome] = useState("");
  const [tituloEleitor, setTituloEleitor] = useState("");
  const [uf, setUf] = useState(defaultUf);
  const [exercicio, setExercicio] = useState(String(defaultExercicio));
  const [message, setMessage] = useState<string | null>(null);
  const [conflitoId, setConflitoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onDocumentoChange(value: string) {
    setDocumento(formatDocumentoInput(tipo, value));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const docError = validateDocumentoInput(tipo, documento);
    if (docError) {
      setMessage(docError);
      return;
    }
    const exercicioNum = Number.parseInt(exercicio, 10);
    if (!uf || uf.length !== 2 || Number.isNaN(exercicioNum)) {
      setMessage("Informe UF e exercício válidos para re-match.");
      return;
    }

    setLoading(true);
    setMessage(null);
    setConflitoId(null);
    try {
      const res = await fetch("/api/pessoas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          documento,
          nome,
          uf: uf.toUpperCase(),
          exercicio: exercicioNum,
          ...(tipo === "PF" && tituloEleitor.trim()
            ? { tituloEleitor: tituloEleitor.trim() }
            : {}),
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setMessage(json.error ?? "Conflito de nome");
        setConflitoId(json.conflitoId ?? null);
        return;
      }
      if (!res.ok) {
        setMessage(json.error ?? "Falha ao cadastrar");
        return;
      }
      router.push(retornoUrl ?? "/pessoas");
      router.refresh();
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <label className="block text-sm">
        Tipo
        <select
          className="mt-1 block w-full max-w-xs rounded-md border border-border-input bg-surface-card px-3 py-2 text-sm text-up-black focus:border-up-black focus:outline-none focus:ring-1 focus:ring-up-black"
          value={tipo}
          onChange={(e) => {
            const next = e.target.value as "PF" | "PJ";
            setTipo(next);
            setDocumento(formatDocumentoInput(next, documento));
          }}
          required
        >
          <option value="PF">Pessoa física (CPF)</option>
          <option value="PJ">Pessoa jurídica (CNPJ)</option>
        </select>
      </label>
      <label className="block text-sm">
        Documento (CPF/CNPJ)
        <Input
          className="mt-1 max-w-md"
          value={documento}
          onChange={(e) => onDocumentoChange(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        Nome
        <Input className="mt-1 max-w-md" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </label>
      {tipo === "PF" ? (
        <label className="block text-sm">
          Título de eleitor (opcional)
          <Input
            className="mt-1 max-w-md"
            value={tituloEleitor}
            onChange={(e) => setTituloEleitor(e.target.value)}
            maxLength={12}
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm">
          UF (re-match)
          <select
            className="mt-1 block w-20 rounded-md border border-border-input bg-surface-card px-2 py-2 text-sm"
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
        <label className="block text-sm">
          Exercício
          <Input
            className="mt-1 w-28"
            type="number"
            value={exercicio}
            onChange={(e) => setExercicio(e.target.value)}
            required
          />
        </label>
      </div>
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      {conflitoId ? (
        <p className="text-sm">
          <Link href="/pessoas/conflitos" className="underline">
            Revisar conflitos pendentes
          </Link>
        </p>
      ) : null}
      <Button type="submit" disabled={loading}>
        {loading ? "Salvando…" : "Cadastrar"}
      </Button>
    </form>
  );
}
