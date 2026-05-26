export const STUB_PF_NOME = "DESCONHECIDO";
export const STUB_PJ_RAZAO = "DESCONHECIDA";

export const CADASTRO_TIPO = { PF: "PF", PJ: "PJ" } as const;
export type CadastroTipo = (typeof CADASTRO_TIPO)[keyof typeof CADASTRO_TIPO];

const TIPO_ALIASES: Record<string, CadastroTipo> = {
  PF: "PF",
  PJ: "PJ",
  FISICA: "PF",
  JURIDICA: "PJ",
  PESSOA_FISICA: "PF",
  PESSOA_JURIDICA: "PJ",
};

function normalizeTipoKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, "_");
}

export function parseCadastroTipo(raw: string): CadastroTipo | null {
  return TIPO_ALIASES[normalizeTipoKey(raw)] ?? null;
}

export function isStubNome(tipo: CadastroTipo, nome: string): boolean {
  const n = nome.trim().toUpperCase();
  return tipo === "PF" ? n === STUB_PF_NOME : n === STUB_PJ_RAZAO;
}
