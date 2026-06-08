"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PessoaEditForm({
  id,
  tipo,
  retornoUrl = "/pessoas",
}: {
  id: string;
  tipo: "pf" | "pj";
  retornoUrl?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [documentoMascarado, setDocumentoMascarado] = useState("");
  const [pessoaTipo, setPessoaTipo] = useState<"PF" | "PJ">("PF");
  const [nome, setNome] = useState("");
  const [tituloEleitor, setTituloEleitor] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/pessoas/${id}?tipo=${tipo}`);
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) setMessage(json.error ?? "Erro ao carregar");
          return;
        }
        if (cancelled) return;
        setPessoaTipo(json.tipo);
        setDocumentoMascarado(json.documento_mascarado ?? "");
        setNome(json.nome ?? "");
        setTituloEleitor(json.titulo_eleitor ?? "");
      } catch {
        if (!cancelled) setMessage("Erro de rede.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, tipo]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) {
      setMessage("Informe o nome.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pessoas/${id}?tipo=${tipo}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          ...(pessoaTipo === "PF" ? { tituloEleitor: tituloEleitor.trim() || null } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "Falha ao salvar");
        return;
      }
      router.push(retornoUrl);
      router.refresh();
    } catch {
      setMessage("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Carregando…</p>;
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-muted">
        {pessoaTipo} · {documentoMascarado}
      </p>
      <label className="block text-sm">
        Nome
        <Input className="mt-1 max-w-md" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </label>
      {pessoaTipo === "PF" ? (
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
      {message ? <p className="text-sm text-red-600">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
        <Link href={retornoUrl}>
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
      </div>
    </form>
  );
}
