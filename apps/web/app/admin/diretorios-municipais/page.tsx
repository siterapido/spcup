"use client";

import { useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { maskCnpj } from "@/lib/mask-document";

type Item = {
  id: string;
  uf: string;
  codigoIbge: string | null;
  nomeMunicipio: string;
  cnpjPrestador: string;
  ativo: boolean;
};

export default function DiretoriosMunicipaisPage() {
  const [uf, setUf] = useState("SP");
  const [items, setItems] = useState<Item[]>([]);
  const [nome, setNome] = useState("");
  const [codigoIbge, setCodigoIbge] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editIbge, setEditIbge] = useState("");
  const [editCnpj, setEditCnpj] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/admin/diretorios-municipais?uf=${encodeURIComponent(uf.toUpperCase())}&ativoOnly=false`,
    );
    const json = await res.json();
    setItems(json.items ?? []);
  }, [uf]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/diretorios-municipais", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uf: uf.toUpperCase(),
        codigoIbge: codigoIbge.trim() || undefined,
        nomeMunicipio: nome,
        cnpjPrestador: cnpj,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Erro ao salvar");
      return;
    }
    setNome("");
    setCodigoIbge("");
    setCnpj("");
    setMessage("Salvo.");
    await load();
  }

  async function onImport(file: File) {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/admin/diretorios-municipais", {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    if (!res.ok) {
      setImportResult(json.error ?? "Erro na importação");
      return;
    }
    const erros = (json.erros as string[] | undefined)?.length ?? 0;
    setImportResult(
      `Importação: ${json.criados ?? 0} criados, ${json.atualizados ?? 0} atualizados, ${erros} erros.`,
    );
    await load();
  }

  function openEdit(item: Item) {
    setEditing(item);
    setEditNome(item.nomeMunicipio);
    setEditIbge(item.codigoIbge ?? "");
    setEditCnpj(item.cnpjPrestador);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const res = await fetch(`/api/admin/diretorios-municipais/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nomeMunicipio: editNome,
        codigoIbge: editIbge.trim() || null,
        cnpjPrestador: editCnpj,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Erro ao atualizar");
      return;
    }
    setEditing(null);
    setMessage("Atualizado.");
    await load();
  }

  async function deactivate(item: Item) {
    const res = await fetch(`/api/admin/diretorios-municipais/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: false }),
    });
    if (!res.ok) {
      const json = await res.json();
      setMessage(json.error ?? "Erro ao desativar");
      return;
    }
    setMessage(`${item.nomeMunicipio} desativado.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Diretórios municipais</h1>
        <p className="mt-1 text-sm text-muted">
          Cadastro mestre UF + município + CNPJ prestador (equipe nacional).
        </p>
      </div>

      <Card>
        <CardTitle>Filtrar</CardTitle>
        <div className="mt-4 flex flex-wrap gap-2">
          <Input
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            className="w-20"
          />
          <Button type="button" variant="outline" onClick={() => void load()}>
            Carregar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
          >
            Importar planilha
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onImport(file);
              e.target.value = "";
            }}
          />
        </div>
        {importResult && <p className="mt-2 text-sm text-muted">{importResult}</p>}
      </Card>

      <Card>
        <CardTitle>Novo município</CardTitle>
        <form onSubmit={onCreate} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            placeholder="Nome do município"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
          />
          <Input
            placeholder="Código IBGE (opcional)"
            value={codigoIbge}
            onChange={(e) => setCodigoIbge(e.target.value)}
          />
          <Input
            placeholder="CNPJ prestador"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            required
          />
          <Button type="submit">Salvar</Button>
        </form>
        {message && <p className="mt-2 text-sm text-muted">{message}</p>}
      </Card>

      <Card>
        <CardTitle>Lista</CardTitle>
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>Município</Th>
              <Th>IBGE</Th>
              <Th>CNPJ</Th>
              <Th>Status</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>{item.nomeMunicipio}</Td>
                <Td>{item.codigoIbge ?? "—"}</Td>
                <Td>{maskCnpj(item.cnpjPrestador)}</Td>
                <Td>{item.ativo ? "Ativo" : "Inativo"}</Td>
                <Td>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openEdit(item)}
                    >
                      Editar
                    </Button>
                    {item.ativo && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void deactivate(item)}
                      >
                        Desativar
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardTitle>Editar {editing.nomeMunicipio}</CardTitle>
            <form onSubmit={saveEdit} className="mt-4 grid gap-3">
              <Input
                placeholder="Nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                required
              />
              <Input
                placeholder="Código IBGE"
                value={editIbge}
                onChange={(e) => setEditIbge(e.target.value)}
              />
              <Input
                placeholder="CNPJ"
                value={editCnpj}
                onChange={(e) => setEditCnpj(e.target.value)}
                required
              />
              <div className="flex gap-2">
                <Button type="submit">Salvar</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(null)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </main>
  );
}
