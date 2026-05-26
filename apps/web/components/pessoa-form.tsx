"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PessoaForm() {
  const router = useRouter();
  const [tipo, setTipo] = useState<"PF" | "PJ">("PF");
  const [documento, setDocumento] = useState("");
  const [nome, setNome] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [conflitoId, setConflitoId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setConflitoId(null);
    try {
      const res = await fetch("/api/pessoas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, documento, nome }),
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
      router.push("/pessoas");
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
          onChange={(e) => setTipo(e.target.value as "PF" | "PJ")}
          required
        >
          <option value="PF">Pessoa física (CPF)</option>
          <option value="PJ">Pessoa jurídica (CNPJ)</option>
        </select>
      </label>
      <label className="block text-sm">
        Documento (CPF/CNPJ)
        <Input className="mt-1 max-w-md" value={documento} onChange={(e) => setDocumento(e.target.value)} required />
      </label>
      <label className="block text-sm">
        Nome
        <Input className="mt-1 max-w-md" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </label>
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
