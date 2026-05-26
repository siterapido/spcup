import Link from "next/link";

import { CadastroImportForm } from "@/components/cadastro-import-form";
import { Card, CardTitle } from "@/components/ui/card";

export default async function ImportarPessoasPage({
  searchParams,
}: {
  searchParams: Promise<{ uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const uf = (params.uf ?? "SP").toUpperCase();
  const exercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm">
        <Link href="/pessoas" className="underline">
          ← Voltar
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Importar cadastro</h1>
      <Card className="mt-6">
        <CardTitle>Planilha</CardTitle>
        <div className="mt-4">
          <CadastroImportForm defaultUf={uf} defaultExercicio={exercicio} />
        </div>
      </Card>
    </main>
  );
}
