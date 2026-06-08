const UF_KEY = "spc_mov_uf";
const DEFAULT_UF = "SP";

export function getDefaultUf(): string {
  if (typeof window === "undefined") return DEFAULT_UF;
  return localStorage.getItem(UF_KEY) ?? DEFAULT_UF;
}

export function setDefaultUf(uf: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UF_KEY, uf.toUpperCase());
}

export function getDefaultMes(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
