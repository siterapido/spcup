export function maskCpf(cpf: string): string {
  if (cpf.length !== 11) {
    return "***";
  }
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

export function maskCnpj(cnpj: string): string {
  if (cnpj.length !== 14) {
    return "**";
  }
  return `**.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-**`;
}

export function maskDocumento(tipo: "PF" | "PJ", documento: string): string {
  return tipo === "PF" ? maskCpf(documento) : maskCnpj(documento);
}
