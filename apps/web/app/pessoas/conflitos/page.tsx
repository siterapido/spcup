import Link from "next/link";

import { ConflitosTable } from "@/components/conflitos-table";
import { Card, CardTitle } from "@/components/ui/card";

export default function ConflitosPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <p className="text-sm">
        <Link href="/pessoas" className="underline">
          ← Voltar
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Conflitos de nome</h1>
      <p className="mt-1 text-sm text-slate-600">
        Revise propostas que divergem do cadastro existente antes de atualizar nomes.
      </p>
      <Card className="mt-6">
        <CardTitle>Pendentes</CardTitle>
        <div className="mt-4">
          <ConflitosTable />
        </div>
      </Card>
    </main>
  );
}
