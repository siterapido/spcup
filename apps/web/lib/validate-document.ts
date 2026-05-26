const CNPJ_TSE_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;

function cpfCheckDigits(cpf: string): boolean {
  if (cpf === cpf[0]!.repeat(11)) return false;
  for (const position of [9, 10] as const) {
    const weights: number[] = [];
    for (let weight = position + 1; weight > 1; weight -= 1) weights.push(weight);
    const total = weights.reduce(
      (sum, weight, index) => sum + Number.parseInt(cpf[index]!, 10) * weight,
      0,
    );
    const expected = total % 11 < 2 ? 0 : 11 - (total % 11);
    if (Number.parseInt(cpf[position]!, 10) !== expected) return false;
  }
  return true;
}

export function validateCpfInput(value: string): string | null {
  const cpf = value.replace(/\D/g, "");
  if (cpf.length !== 11) return "CPF deve ter 11 dígitos";
  if (!cpfCheckDigits(cpf)) return "CPF inválido: dígitos verificadores incorretos";
  return null;
}

export function validateCnpjInput(value: string): string | null {
  const cnpj = value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!CNPJ_TSE_PATTERN.test(cnpj)) return "CNPJ inválido: padrão TSE não atendido";
  return null;
}

export function validateDocumentoInput(tipo: "PF" | "PJ", value: string): string | null {
  return tipo === "PF" ? validateCpfInput(value) : validateCnpjInput(value);
}
