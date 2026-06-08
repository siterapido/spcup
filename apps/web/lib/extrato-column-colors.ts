/** Cores por campo para faixas de coluna no PDF (RGBA). */
export const CAMPO_COLORS: Record<string, string> = {
  data: "rgba(37, 99, 235, 0.42)",
  valor: "rgba(22, 163, 74, 0.42)",
  direcao: "rgba(234, 88, 12, 0.42)",
  documento: "rgba(147, 51, 234, 0.42)",
  cpf_cnpj: "rgba(168, 85, 247, 0.42)",
  nome: "rgba(8, 145, 178, 0.42)",
  historico: "rgba(202, 138, 4, 0.42)",
  saldo: "rgba(100, 116, 139, 0.45)",
  tipo_pix: "rgba(219, 39, 119, 0.42)",
  situacao: "rgba(185, 28, 28, 0.38)",
  cred_dev: "rgba(219, 39, 119, 0.35)",
  hora: "rgba(79, 70, 229, 0.38)",
};

export const CAMPO_BORDER_COLORS: Record<string, string> = {
  data: "rgb(37, 99, 235)",
  valor: "rgb(22, 163, 74)",
  direcao: "rgb(234, 88, 12)",
  documento: "rgb(147, 51, 234)",
  cpf_cnpj: "rgb(168, 85, 247)",
  nome: "rgb(8, 145, 178)",
  historico: "rgb(202, 138, 4)",
  saldo: "rgb(71, 85, 105)",
  tipo_pix: "rgb(219, 39, 119)",
  situacao: "rgb(185, 28, 28)",
  cred_dev: "rgb(219, 39, 119)",
  hora: "rgb(79, 70, 229)",
};

export function colorForCampo(campo: string, index = 0): string {
  if (CAMPO_COLORS[campo]) {
    return CAMPO_COLORS[campo]!;
  }
  const hue = (index * 47 + campo.length * 13) % 360;
  return `hsla(${hue}, 65%, 45%, 0.4)`;
}

export function borderForCampo(campo: string, index = 0): string {
  if (CAMPO_BORDER_COLORS[campo]) {
    return CAMPO_BORDER_COLORS[campo]!;
  }
  const hue = (index * 47 + campo.length * 13) % 360;
  return `hsl(${hue}, 65%, 38%)`;
}
