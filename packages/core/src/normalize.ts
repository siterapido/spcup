/** CPF, CNPJ, and name normalization for SPCA import. */

const CNPJ_TSE_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;

function cpfCheckDigits(cpf: string): boolean {
  if (cpf === cpf[0]!.repeat(11)) {
    return false;
  }

  for (const position of [9, 10] as const) {
    const weights: number[] = [];
    for (let weight = position + 1; weight > 1; weight -= 1) {
      weights.push(weight);
    }
    const total = weights.reduce(
      (sum, weight, index) => sum + Number.parseInt(cpf[index]!, 10) * weight,
      0,
    );
    const expected = total % 11 < 2 ? 0 : 11 - (total % 11);
    if (Number.parseInt(cpf[position]!, 10) !== expected) {
      return false;
    }
  }
  return true;
}

/** Strip mask, validate check digits, return 11 digits or throw. */
export function normalizeCpf(value: string): string {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11) {
    throw new Error("CPF inválido: deve conter 11 dígitos");
  }
  if (!cpfCheckDigits(cpf)) {
    throw new Error("CPF inválido: dígitos verificadores incorretos");
  }
  return cpf;
}

/** Strip mask and validate TSE alphanumeric pattern [A-Z0-9]{12}[0-9]{2}. */
export function normalizeCnpj(value: string): string {
  const cnpj = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!CNPJ_TSE_PATTERN.test(cnpj)) {
    throw new Error("CNPJ inválido: padrão TSE não atendido");
  }
  return cnpj;
}

/** Uppercase, collapse whitespace, optionally remove accents. */
export function normalizeName(
  value: string,
  options?: { removeAccents?: boolean },
): string {
  const removeAccents = options?.removeAccents ?? true;
  let text = value.split(/\s+/).filter(Boolean).join(" ");
  if (removeAccents) {
    text = text
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "");
  }
  return text.toUpperCase();
}
