import { getSessao, listConsolidacaoForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";

import {
  ConsolidacaoPageHeader,
  ConsolidacaoTable,
} from "@/components/prestacao/consolidacao-table";
import { Card } from "@/components/ui/card";

export default async function ConsolidacaoPage({
  params,
}: {
  params: Promise<{ sessaoId: string }>;
}) {
  const { sessaoId } = await params;
  const db = getDb();
  const { eventos, cadastroAlerta } = await listConsolidacaoForSessao(db, sessaoId);
  const sessao = await getSessao(db, sessaoId);

  if (!sessao) {
    throw new Error("Sessão não encontrada");
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Card className="p-6">
        <ConsolidacaoPageHeader sessaoId={sessaoId} />
        <div className="mt-6">
          <ConsolidacaoTable
            sessaoId={sessaoId}
            eventos={eventos}
            cadastroAlerta={cadastroAlerta}
            uf={sessao.uf}
            exercicio={sessao.exercicio}
          />
        </div>
      </Card>
    </main>
  );
}
