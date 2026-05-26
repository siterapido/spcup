"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";

type Item = {
  id: string;
  uf: string;
  nomeMunicipio: string;
  cnpjPrestador: string;
};

export default function DiretoriosMunicipaisPage() {
  const [uf, setUf] = useState("SP");
  const [items, setItems] = useState<Item[]>([]);
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/admin/diretorios-municipais?uf=${encodeURIComponent(uf.toUpperCase())}`,
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
    setCnpj("");
    setMessage("Salvo.");
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
        <div className="mt-4 flex gap-2">
          <Input
            maxLength={2}
            value={uf}
            onChange={(e) => setUf(e.target.value.toUpperCase())}
            className="w-20"
          />
          <Button type="button" variant="outline" onClick={() => void load()}>
            Carregar
          </Button>
        </div>
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
              <Th>CNPJ</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <Td>{item.nomeMunicipio}</Td>
                <Td>{item.cnpjPrestador}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </main>
  );
}
