import Link from "next/link";

import { PessoaEditForm } from "@/components/pessoa-edit-form";
import { Card, CardTitle } from "@/components/ui/card";

export default async function PessoaEditarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tipoRaw = (sp.tipo ?? "pf").toLowerCase();
  const tipo = tipoRaw === "pj" ? "pj" : "pf";

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-sm">
        <Link href="/pessoas" className="underline">
          ← Voltar
        </Link>
      </p>
      <Card className="mt-6">
        <CardTitle>Editar cadastro</CardTitle>
        <div className="mt-4">
          <PessoaEditForm
            id={id}
            tipo={tipo}
            retornoUrl={`/pessoas/${id}?tipo=${tipo}`}
          />
        </div>
      </Card>
    </main>
  );
}
