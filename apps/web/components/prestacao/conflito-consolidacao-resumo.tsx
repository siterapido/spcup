"use client";

import { stripDocumentsFromDescricao } from "@spc-up/core/browser";

/** Dados mínimos do evento para explicar o conflito (evita dependência circular). */
export type EventoConflitoInput = {
  id: string;
  status: string;
  dataMovimento: string;
  valor: string;
  direcao: string;
  confianca: number;
  justificativa: string | null;
  linhas: Array<{
    descricaoRaw: string;
    papel: string;
    nomeArquivo: string | null;
  }>;
  pessoa: {
    nome: string;
    tipo: "PF" | "PJ";
  } | null;
};

export type ConflitoItem = {
  id: string;
  severidade: "error" | "warning" | "info";
  titulo: string;
  descricao: string;
  acao: string;
};

export type ConflitoAnalise = {
  status: "bloqueado" | "revisar" | "pronto";
  tituloPrincipal: string;
  itens: ConflitoItem[];
  duplicatasMesmoValor: EventoConflitoInput[];
};

function cleanTransactionName(desc: string): string {
  if (!desc) return "";
  let name = desc;
  name = name.replace(
    /\b(PIX|TEV|TED|DOC|COBRANCA|TRANSF|RECEBIDO|ENVIADO|PAGTO|PGTO|DEPOSITO|DEP|LIQ|LIQUIDACAO|TARIFA|TAR|DOC\s*EXTRATO|PAGAMENTO)\b/gi,
    "",
  );
  name = name.replace(/[-:;*#_]/g, " ");
  name = stripDocumentsFromDescricao(name);
  return name.replace(/\s+/g, " ").trim();
}

function eventosMesmoValor(
  ev: EventoConflitoInput,
  eventos: EventoConflitoInput[],
): EventoConflitoInput[] {
  return eventos.filter(
    (other) =>
      other.valor === ev.valor &&
      other.dataMovimento === ev.dataMovimento &&
      other.direcao === ev.direcao,
  );
}

function rotuloEvento(ev: EventoConflitoInput): string {
  const descricao =
    cleanTransactionName(ev.linhas[0]?.descricaoRaw || "") ||
    ev.linhas[0]?.descricaoRaw?.trim() ||
    "Sem descrição";
  return ev.pessoa ? `${ev.pessoa.nome} — ${descricao}` : descricao;
}

export function analisarConflitoConsolidacao(
  ev: EventoConflitoInput,
  todosEventos: EventoConflitoInput[],
): ConflitoAnalise {
  const itens: ConflitoItem[] = [];
  const duplicatasMesmoValor = eventosMesmoValor(ev, todosEventos);

  if (duplicatasMesmoValor.length > 1) {
    itens.push({
      id: "mesmo-valor",
      severidade: "warning",
      titulo: "Várias movimentações iguais no mesmo dia",
      descricao: `Existem ${duplicatasMesmoValor.length} lançamentos de R$ ${ev.valor} em ${ev.dataMovimento} (${ev.direcao === "ENTRADA" ? "entrada" : "saída"}). Podem ser pessoas diferentes.`,
      acao: "Confira cada uma no PDF, vincule a pessoa certa em cada card e só então confirme — não assuma que todas são do mesmo titular.",
    });
  }

  if (!ev.pessoa) {
    const motivo =
      ev.justificativa?.trim() ||
      "O sistema não encontrou CPF, CNPJ ou nome único no cadastro da UF para esta linha.";
    itens.push({
      id: "sem-pessoa",
      severidade: "error",
      titulo: "Falta definir de quem é esta transação",
      descricao: motivo,
      acao: 'Abra o PDF abaixo, identifique o titular na descrição e escolha (ou cadastre) a pessoa em "Vincular Cliente/Fornecedor". Sem isso não é possível confirmar.',
    });
  }

  if (ev.pessoa) {
    const cleanExtrato = cleanTransactionName(ev.linhas[0]?.descricaoRaw || "");
    const cleanCadastro = cleanTransactionName(ev.pessoa.nome);
    if (cleanExtrato && cleanCadastro && cleanExtrato !== cleanCadastro) {
      itens.push({
        id: "nome-divergente",
        severidade: "warning",
        titulo: "Nome no extrato não coincide com o cadastro sugerido",
        descricao: `Extrato: «${cleanExtrato}». Cadastro vinculado: «${ev.pessoa.nome}».`,
        acao: "Verifique no PDF se é a mesma pessoa (abreviações são comuns). Se não for, troque o vínculo antes de confirmar.",
      });
    }
  }

  if (ev.confianca < 0.65) {
    itens.push({
      id: "baixa-confianca",
      severidade: "warning",
      titulo: "Sugestão automática fraca",
      descricao: `Confiança de ${Math.round(ev.confianca * 100)}%${ev.justificativa ? ` — ${ev.justificativa}` : "."}`,
      acao: "Trate como suspeita: confira data, valor e nome no PDF antes de confirmar ou troque o vínculo.",
    });
  } else if (ev.confianca < 0.85 && ev.pessoa && !itens.some((i) => i.id === "nome-divergente")) {
    itens.push({
      id: "media-confianca",
      severidade: "info",
      titulo: "Sugestão automática — validação recomendada",
      descricao: ev.justificativa
        ? `${ev.justificativa} (confiança ${Math.round(ev.confianca * 100)}%).`
        : `Confiança ${Math.round(ev.confianca * 100)}% — o sistema acha provável, mas não tem certeza absoluta.`,
      acao: "Compare com o PDF na seção «Conferência no PDF» e confirme só se estiver correto.",
    });
  }

  if (
    ev.linhas.length >= 2 &&
    ev.pessoa &&
    !itens.some((i) => i.id === "mesmo-valor")
  ) {
    const papeis = [...new Set(ev.linhas.map((l) => l.papel))].join(" + ");
    itens.push({
      id: "cruzamento-pdf",
      severidade: "info",
      titulo: "Mesma transação em mais de um extrato",
      descricao: `Cruzamento ${papeis}${ev.justificativa ? ` — ${ev.justificativa}` : "."}`,
      acao: "Use a tabela «Conferência no PDF» para ver onde data, valor e titular aparecem em cada arquivo.",
    });
  }

  const hasError = itens.some((i) => i.severidade === "error");
  const hasWarning = itens.some((i) => i.severidade === "warning");

  let status: ConflitoAnalise["status"];
  if (hasError) {
    status = "bloqueado";
  } else if (hasWarning) {
    status = "revisar";
  } else if (ev.pessoa) {
    status = "pronto";
  } else {
    status = "bloqueado";
  }

  if (status === "pronto" && itens.length === 0 && ev.pessoa) {
    itens.push({
      id: "pronto",
      severidade: "info",
      titulo: "Sugestão forte — confirme após olhar o PDF",
      descricao: `O sistema vinculou ${ev.pessoa.nome} (${ev.pessoa.tipo}) com ${Math.round(ev.confianca * 100)}% de confiança, mas este item ficou na fila manual (ex.: reprocessamento ou limiar não atingido na geração).`,
      acao: "Se estiver correto, clique em Confirmar. Se não, troque o vínculo.",
    });
  }

  const tituloPrincipal =
    status === "bloqueado"
      ? "Não pode confirmar ainda"
      : status === "revisar"
        ? "Revise antes de confirmar"
        : "Pode confirmar após conferir o PDF";

  return { status, tituloPrincipal, itens, duplicatasMesmoValor };
}

const STATUS_STYLES: Record<
  ConflitoAnalise["status"],
  { border: string; bg: string; badge: string; badgeText: string }
> = {
  bloqueado: {
    border: "border-rose-300",
    bg: "bg-rose-50/90",
    badge: "bg-rose-200",
    badgeText: "text-rose-950",
  },
  revisar: {
    border: "border-amber-300",
    bg: "bg-amber-50/90",
    badge: "bg-amber-200",
    badgeText: "text-amber-950",
  },
  pronto: {
    border: "border-emerald-300",
    bg: "bg-emerald-50/80",
    badge: "bg-emerald-200",
    badgeText: "text-emerald-950",
  },
};

const ITEM_STYLES: Record<ConflitoItem["severidade"], string> = {
  error: "border-rose-200/90 bg-white/80",
  warning: "border-amber-200/90 bg-white/70",
  info: "border-slate-200/90 bg-white/60",
};

type PanelProps = {
  analise: ConflitoAnalise;
  eventoAtualId: string;
  onIrParaEvento?: (eventoId: string) => void;
};

export function ConflitoConsolidacaoResumo({
  analise,
  eventoAtualId,
  onIrParaEvento,
}: PanelProps) {
  const styles = STATUS_STYLES[analise.status];
  const outrasDuplicatas = analise.duplicatasMesmoValor.filter((d) => d.id !== eventoAtualId);

  return (
    <div className={`rounded-lg border p-3.5 space-y-3 ${styles.border} ${styles.bg}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <span
            className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles.badge} ${styles.badgeText}`}
          >
            {analise.tituloPrincipal}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">O que precisa ser resolvido</p>
        </div>
      </div>

      <ul className="space-y-2.5">
        {analise.itens.map((item) => (
          <li
            key={item.id}
            className={`rounded-md border px-3 py-2.5 text-sm ${ITEM_STYLES[item.severidade]}`}
          >
            <p className="font-semibold text-slate-900">{item.titulo}</p>
            <p className="mt-1 text-slate-700 leading-snug">{item.descricao}</p>
            <p className="mt-2 text-xs font-medium text-slate-800">
              <span className="text-slate-500">O que fazer: </span>
              {item.acao}
            </p>
          </li>
        ))}
      </ul>

      {outrasDuplicatas.length > 0 && (
        <div className="rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-xs text-amber-950">
          <p className="font-semibold text-amber-900 mb-1.5">Outras movimentações com o mesmo valor</p>
          <ul className="space-y-1">
            {outrasDuplicatas.map((outra) => (
              <li key={outra.id}>
                {onIrParaEvento && outra.status === "PENDENTE" ? (
                  <button
                    type="button"
                    className="text-left underline decoration-amber-500 underline-offset-2 hover:text-amber-950"
                    onClick={() => onIrParaEvento(outra.id)}
                  >
                    {rotuloEvento(outra)}
                  </button>
                ) : (
                  <span>{rotuloEvento(outra)}</span>
                )}
                {outra.status !== "PENDENTE" && (
                  <span className="ml-1 italic text-amber-800">(já validada)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
