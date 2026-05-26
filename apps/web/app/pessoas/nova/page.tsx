import Link from "next/link";

import { PessoaForm } from "@/components/pessoa-form";
import { Card, CardTitle } from "@/components/ui/card";

export default function NovaPessoaPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm">
        <Link href="/pessoas" className="underline">
          ← Voltar
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Novo cadastro</h1>
      <p className="mt-1 text-sm text-muted">
        Um cadastro por CPF ou CNPJ. Campos obrigatórios: tipo, documento e nome.
      </p>
      <Card className="mt-6">
        <CardTitle>Dados</CardTitle>
        <div className="mt-4">
          <PessoaForm />
        </div>
      </Card>
    </main>
  );
}
