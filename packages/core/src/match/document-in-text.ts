const CPF_IN_TEXT =
  /\b(?:\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/;
const CNPJ_IN_TEXT =
  /\b(?:\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|[A-Za-z0-9]{2}\.?[A-Za-z0-9]{3}\.?[A-Za-z0-9]{3}\/?[A-Za-z0-9]{4}-?\d{2})\b/;

export const CPF_PATTERN = new RegExp(CPF_IN_TEXT.source, "g");
export const CNPJ_PATTERN = new RegExp(CNPJ_IN_TEXT.source, "g");

/** First CPF in text, masked (`123.456.789-09`) or plain (`12345678909`). */
export function findCpfInDescricao(descricao: string): string | null {
  return descricao.match(CPF_IN_TEXT)?.[0] ?? null;
}

/** First CNPJ in text, masked or plain. */
export function findCnpjInDescricao(descricao: string): string | null {
  return descricao.match(CNPJ_IN_TEXT)?.[0] ?? null;
}

export function hasCpfInDescricao(descricao: string): boolean {
  return CPF_IN_TEXT.test(descricao);
}

/** Remove CPF/CNPJ tokens (with optional label) from description text. */
export function stripDocumentsFromDescricao(descricao: string): string {
  return descricao
    .replace(/\b(?:CPF|CNPJ)\s+/gi, "")
    .replace(CPF_PATTERN, "")
    .replace(CNPJ_PATTERN, "")
    .trim();
}
