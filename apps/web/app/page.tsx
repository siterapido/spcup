import Link from "next/link";

import { UploadForm } from "@/components/upload-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { canExport, listRecentSessoes } from "@spc-up/core";
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
  let sessoesRecentes: Awaited<ReturnType<typeof listRecentSessoes>> = [];
  try {
    const db = getDb();
    exportavel = await canExport(db, uf, exercicio);
    sessoesRecentes = await listRecentSessoes(db, 8);
  } catch {
    exportavel = false;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Prestação de Contas</h1>
        <p className="mt-2 text-muted">
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
        <CardTitle>Fluxo guiado</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Wizard com UF, prestador estadual/municipal, anexos e kanban por movimentação.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            href="/prestacao/nova"
            className="inline-flex items-center justify-center rounded-md bg-up-black px-4 py-2 text-sm font-medium text-up-white hover:bg-up-black-hover"
          >
            Nova prestação
          </Link>
          <Link
            href="/admin/diretorios-municipais"
            className="inline-flex items-center justify-center rounded-md border border-border-default bg-white px-4 py-2 text-sm font-medium text-up-black hover:bg-slate-50"
          >
            Cadastro municipal
          </Link>
        </div>
      </Card>

      {sessoesRecentes.length > 0 && (
        <Card>
          <CardTitle>Sessões recentes</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {sessoesRecentes.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/prestacao/${s.id}/kanban`}
                  className="font-medium text-up-black underline decoration-up-yellow decoration-2 underline-offset-2"
                >
                  {s.uf} · {s.tipoPrestador} · {s.exercicio}
                </Link>
                <span className="text-muted">
                  {" "}
                  — {s.diretorioMunicipal?.nomeMunicipio ?? s.diretorioEstadual?.nome}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Filtro UF / exercício</CardTitle>
        <form className="mt-4 flex flex-wrap gap-3" method="get">
          <Input name="uf" defaultValue={uf} maxLength={2} className="w-20" />
          <Input
            name="exercicio"
            type="number"
            defaultValue={exercicio}
            className="w-28"
          />
          <Button type="submit" variant="outline">
            Aplicar
          </Button>
        </form>
      </Card>

      <p className="flex flex-wrap gap-4">
        <Link
          href={`/movimentacoes?uf=${uf}&exercicio=${exercicio}`}
          className="font-medium text-up-black underline decoration-up-yellow decoration-2 underline-offset-4 hover:text-up-black-hover"
        >
          Ver movimentações
        </Link>
        <Link
          href={`/pessoas?uf=${uf}&exercicio=${exercicio}`}
          className="font-medium text-up-black underline decoration-up-yellow decoration-2 underline-offset-4 hover:text-up-black-hover"
        >
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
        <p className="mt-2 text-sm text-muted">
          Baixa ZIP com 3 XMLs (origem, aplicação, doação) quando a exportação estiver liberada.
        </p>
        <div className="mt-4">
          {exportavel ? (
            <a
              href={`/api/export/${uf}/${exercicio}`}
              className="inline-flex items-center justify-center rounded-md bg-up-black px-4 py-2 text-sm font-medium text-up-white transition-colors duration-150 ease-out-quart hover:bg-up-black-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-up-black focus-visible:ring-offset-2"
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
