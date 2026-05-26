export const VALID_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type UfSigla = (typeof VALID_UFS)[number];

export function isValidUf(uf: string): boolean {
  return VALID_UFS.includes(uf.toUpperCase() as UfSigla);
}

/** Seed script uses 00000000000100–126 — treat as not production-ready. */
export function isPlaceholderCnpjPrestador(cnpj: string): boolean {
  return /^00000000000/.test(cnpj);
}
