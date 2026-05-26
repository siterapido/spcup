import Link from "next/link";

import { PessoaForm } from "@/components/pessoa-form";
import { Card, CardTitle } from "@/components/ui/card";

export default async function NovaPessoaPage({
  searchParams,
}: {
  searchParams: Promise<{ retorno?: string; uf?: string; exercicio?: string }>;
}) {
  const params = await searchParams;
  const retorno = params.retorno?.startsWith("/") ? params.retorno : null;
  const defaultUf = (params.uf ?? "SP").toUpperCase();
  const defaultExercicio = Number.parseInt(params.exercicio ?? "2025", 10);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm">
        <Link href={retorno ?? "/pessoas"} className="underline">
          ← Voltar
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Novo cadastro</h1>
      <p className="mt-1 text-sm text-muted">
        Um cadastro por CPF ou CNPJ. Após salvar, re-match das movimentações pendentes na UF e
        exercício informados.
      </p>
      <Card className="mt-6">
        <CardTitle>Dados</CardTitle>
        <div className="mt-4">
          <PessoaForm
            defaultUf={defaultUf}
            defaultExercicio={Number.isNaN(defaultExercicio) ? 2025 : defaultExercicio}
            retornoUrl={retorno}
          />
        </div>
      </Card>
    </main>
  );
}
