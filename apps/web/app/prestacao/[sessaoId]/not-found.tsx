import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export default function PrestacaoSessaoNotFound() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Card className="space-y-4 text-center">
        <CardTitle>Prestação não encontrada</CardTitle>
        <p className="text-sm text-muted">
          Essa sessão não existe ou foi excluída. Abra uma prestação ativa na lista ou crie uma
          nova.
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Link href="/prestacao" className={buttonClassName()}>
            Ver prestações
          </Link>
          <Link href="/prestacao/nova" className={buttonClassName("outline")}>
            Nova prestação
          </Link>
        </div>
      </Card>
    </main>
  );
}
