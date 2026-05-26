import Link from "next/link";

import { CadastroImportForm } from "@/components/cadastro-import-form";
import { Card, CardTitle } from "@/components/ui/card";

export default function ImportarPessoasPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-sm">
        <Link href="/pessoas" className="underline">
          ← Voltar
        </Link>
      </p>
      <h1 className="mt-4 text-2xl font-semibold">Importar cadastro</h1>
      <p className="mt-1 text-sm text-muted">
        Selecione a planilha, mapeie documento e nome (tipo opcional). Um cadastro por CPF ou CNPJ.
      </p>
      <Card className="mt-6">
        <CardTitle>Planilha</CardTitle>
        <div className="mt-4">
          <CadastroImportForm />
        </div>
      </Card>
    </main>
  );
}
