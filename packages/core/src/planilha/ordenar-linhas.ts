import type { PlanilhaLinha } from "./types";
import {
  compareLinhasPlanilhaCronologicamente,
  ordenarLinhasPlanilhaCronologicamente,
} from "./ordenar-linhas-cronologico";

export type PlanilhaOrdenacao =
  | "cronologico_asc"
  | "cronologico_desc"
  | "confianca_desc"
  | "confianca_asc"
  | "valor_desc"
  | "valor_asc";

export const PLANILHA_ORDENACAO_PADRAO: PlanilhaOrdenacao = "cronologico_asc";

export const PLANILHA_ORDENACAO_OPCOES: ReadonlyArray<{
  id: PlanilhaOrdenacao;
  label: string;
}> = [
  { id: "cronologico_asc", label: "Data (mais antiga)" },
  { id: "cronologico_desc", label: "Data (mais recente)" },
  { id: "confianca_desc", label: "Confiança (maior)" },
  { id: "confianca_asc", label: "Confiança (menor)" },
  { id: "valor_desc", label: "Valor (maior)" },
  { id: "valor_asc", label: "Valor (menor)" },
];

function compareValor(a: PlanilhaLinha, b: PlanilhaLinha): number {
  const va = Number(a.valor);
  const vb = Number(b.valor);
  if (va !== vb) return va - vb;
  return compareLinhasPlanilhaCronologicamente(a, b);
}

function compareConfianca(a: PlanilhaLinha, b: PlanilhaLinha): number {
  if (a.confianca !== b.confianca) return a.confianca - b.confianca;
  return compareLinhasPlanilhaCronologicamente(a, b);
}

export function ordenarLinhasPlanilha(
  linhas: PlanilhaLinha[],
  ordenacao: PlanilhaOrdenacao = PLANILHA_ORDENACAO_PADRAO,
): PlanilhaLinha[] {
  switch (ordenacao) {
    case "cronologico_asc":
      return ordenarLinhasPlanilhaCronologicamente(linhas);
    case "cronologico_desc":
      return [...linhas].sort(
        (a, b) => compareLinhasPlanilhaCronologicamente(b, a),
      );
    case "confianca_desc":
      return [...linhas].sort((a, b) => compareConfianca(b, a));
    case "confianca_asc":
      return [...linhas].sort(compareConfianca);
    case "valor_desc":
      return [...linhas].sort((a, b) => compareValor(b, a));
    case "valor_asc":
      return [...linhas].sort(compareValor);
    default:
      return ordenarLinhasPlanilhaCronologicamente(linhas);
  }
}

export function isPlanilhaOrdenacao(value: string): value is PlanilhaOrdenacao {
  return PLANILHA_ORDENACAO_OPCOES.some((o) => o.id === value);
}
