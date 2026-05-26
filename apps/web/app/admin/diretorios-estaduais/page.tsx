"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { maskCnpj } from "@/lib/mask-document";

type Item = {
  id: string;
  uf: string;
  nome: string;
  cnpjPrestador: string;
  ativo: boolean;
  placeholder: boolean;
};

type ImportErro = { linha: number; motivo: string };

export default function DiretoriosEstaduaisPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [importErros, setImportErros] = useState<ImportErro[]>([]);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editCnpj, setEditCnpj] = useState("");
  const [editAtivo, setEditAtivo] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/diretorios-estaduais?ativoOnly=false");
    const json = await res.json();
    setItems(json.items ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEdit(item: Item) {
    setEditing(item);
    setEditNome(item.nome);
    setEditCnpj(item.cnpjPrestador);
    setEditAtivo(item.ativo);
    setEditError(null);
  }

  function closeEdit() {
    setEditing(null);
    setEditError(null);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);

    const res = await fetch(`/api/admin/diretorios-estaduais/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: editNome,
        cnpjPrestador: editCnpj,
        ativo: editAtivo,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setEditError(json.error ?? "Erro ao salvar");
      return;
    }
    closeEdit();
    setMessage("Salvo.");
    await load();
  }

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setImportErros([]);

    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/diretorios-estaduais", {
      method: "POST",
      body: form,
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error ?? "Erro na importação");
      return;
    }
    setMessage(`${json.atualizados ?? 0} linha(s) atualizada(s).`);
    setImportErros(json.erros ?? []);
    await load();
    e.target.value = "";
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Diretórios estaduais</h1>
        <p className="mt-1 text-sm text-muted">
          Cadastro mestre das 27 UFs — CNPJ e nome do prestador estadual.
        </p>
      </div>

      <Card>
        <CardTitle>Importar planilha</CardTitle>
        <p className="mt-2 text-sm text-muted">
          CSV com colunas: uf, cnpj, nome (separador , ou ;)
        </p>
        <input
          type="file"
          accept=".csv,.txt"
          className="mt-4 block text-sm"
          onChange={(ev) => void onImport(ev)}
        />
        {message && <p className="mt-2 text-sm text-muted">{message}</p>}
        {importErros.length > 0 && (
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>Linha</Th>
                <Th>Motivo</Th>
              </tr>
            </thead>
            <tbody>
              {importErros.map((erro) => (
                <tr key={erro.linha}>
                  <Td>{erro.linha}</Td>
                  <Td>{erro.motivo}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardTitle>UFs ({items.length})</CardTitle>
        <Table className="mt-4">
          <thead>
            <tr>
              <Th>UF</Th>
              <Th>Nome</Th>
              <Th>CNPJ</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>{item.uf}</Td>
                <Td>{item.nome}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-2">
                    {maskCnpj(item.cnpjPrestador)}
                    {item.placeholder && (
                      <Badge tone="warn">CNPJ pendente</Badge>
                    )}
                  </span>
                </Td>
                <Td>
                  <Badge tone={item.ativo ? "success" : "neutral"}>
                    {item.ativo ? "Ativo" : "Inativo"}
                  </Badge>
                </Td>
                <Td>
                  <Button type="button" variant="outline" onClick={() => openEdit(item)}>
                    Editar
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md">
            <CardTitle>Editar {editing.uf}</CardTitle>
            <form onSubmit={onSaveEdit} className="mt-4 space-y-3">
              <Input
                placeholder="Nome"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                required
              />
              <Input
                placeholder="CNPJ prestador (14 dígitos)"
                value={editCnpj}
                onChange={(e) => setEditCnpj(e.target.value)}
                required
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editAtivo}
                  onChange={(e) => setEditAtivo(e.target.checked)}
                />
                Ativo
              </label>
              {editError && <p className="text-sm text-status-danger-text">{editError}</p>}
              <div className="flex gap-2">
                <Button type="submit">Salvar</Button>
                <Button type="button" variant="outline" onClick={closeEdit}>
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
