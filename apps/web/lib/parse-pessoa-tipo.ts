import type { CadastroTipo } from "@spc-up/core";

export function parsePessoaTipoParam(
  raw: string | null | undefined,
): CadastroTipo | null {
  if (!raw) {
    return null;
  }
  const key = raw.trim().toLowerCase();
  if (key === "pf" || key === "fisica") {
    return "PF";
  }
  if (key === "pj" || key === "juridica") {
    return "PJ";
  }
  return null;
}
