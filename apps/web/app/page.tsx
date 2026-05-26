import Link from "next/link";

import { UploadForm } from "@/components/upload-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { canExport } from "@spc-up/core";
import { getDb } from "@spc-up/db";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const uf = (params.uf ?? "SP").toUpperCase();
  const exercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  let exportavel = false;
  try {
    const db = getDb();
    exportavel = await canExport(db, uf, exercicio);
  } catch {
    exportavel = false;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Prestação de Contas</h1>
        <p className="mt-2 text-slate-600">
          UF <strong>{uf}</strong> · Exercício <strong>{exercicio}</strong>
        </p>
        <p className="mt-2">
          Exportação SPCA:{" "}
          <Badge tone={exportavel ? "success" : "danger"}>
            {exportavel ? "liberada" : "bloqueada (há pendências)"}
          </Badge>
        </p>
      </div>

      <Card>
        <CardTitle>Filtro UF / exercício</CardTitle>
        <form className="mt-4 flex flex-wrap gap-3" method="get">
          <input
            name="uf"
            defaultValue={uf}
            maxLength={2}
            className="w-20 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="exercicio"
            type="number"
            defaultValue={exercicio}
            className="w-28 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <Button type="submit" variant="outline">
            Aplicar
          </Button>
        </form>
      </Card>

      <p className="flex flex-wrap gap-4">
        <Link href={`/movimentacoes?uf=${uf}&exercicio=${exercicio}`} className="text-slate-900 underline">
          Ver movimentações
        </Link>
        <Link href={`/pessoas?uf=${uf}&exercicio=${exercicio}`} className="text-slate-900 underline">
          Pessoas (PF/PJ)
        </Link>
      </p>

      <Card>
        <CardTitle>Upload</CardTitle>
        <div className="mt-4">
          <UploadForm defaultUf={uf} defaultExercicio={exercicio} />
        </div>
      </Card>

      <Card>
        <CardTitle>Exportar XML SPCA</CardTitle>
        <p className="mt-2 text-sm text-slate-600">
          Baixa ZIP com 3 XMLs (origem, aplicação, doação) quando a exportação estiver liberada.
        </p>
        <div className="mt-4">
          {exportavel ? (
            <a
              href={`/api/export/${uf}/${exercicio}`}
              className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Baixar ZIP
            </a>
          ) : (
            <Button disabled>Baixar ZIP (bloqueado)</Button>
          )}
        </div>
      </Card>
    </main>
  );
}
