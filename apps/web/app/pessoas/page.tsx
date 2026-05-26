import Link from "next/link";

import { PessoasTable } from "@/components/pessoas-table";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export default function PessoasPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pessoas (PF/PJ)</h1>
          <p className="mt-1 text-sm text-slate-600">
            Cadastro nacional usado para identificar transações na prestação de contas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/pessoas/nova">
            <Button>Novo cadastro</Button>
          </Link>
          <Link href="/pessoas/importar">
            <Button variant="outline">Importar planilha</Button>
          </Link>
          <Link href="/pessoas/conflitos">
            <Button variant="outline">Conflitos</Button>
          </Link>
        </div>
      </div>
      <Card className="mt-6">
        <CardTitle>Cadastros</CardTitle>
        <div className="mt-4">
          <PessoasTable />
        </div>
      </Card>
    </main>
  );
}
