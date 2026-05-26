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

export function parseCadastroTipo(raw: string): CadastroTipo | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return TIPO_ALIASES[key] ?? null;
}

export function isStubNome(tipo: CadastroTipo, nome: string): boolean {
  const n = nome.trim().toUpperCase();
  return tipo === "PF" ? n === STUB_PF_NOME : n === STUB_PJ_RAZAO;
}
