export function maskCpf(cpf: string): string {
  if (cpf.length !== 11) {
    return cpf;
  }
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9, 11)}`;
}

export function maskCnpj(cnpj: string): string {
  if (cnpj.length !== 14) {
    return cnpj;
  }
  return `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12, 14)}`;
}

export function maskDocumento(tipo: "PF" | "PJ", documento: string): string {
  return tipo === "PF" ? maskCpf(documento) : maskCnpj(documento);
}
