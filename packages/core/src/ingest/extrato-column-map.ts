export type ExtratoColumnMapEntry = {
  campo: string;
  label?: string;
  colunaIndex: number;
  headerLabel?: string;
  xInicio?: number;
  xFim?: number;
};

export type ExtratoColumnMap = {
  paginaReferencia: 1;
  inferirDirecaoDoValor?: boolean;
  colunaDirecaoDetectada?: boolean;
  colunas: ExtratoColumnMapEntry[];
};

export const EXTRATO_COLUMN_MAP_CAMPOS_PADRAO = [
  "data",
  "valor",
  "direcao",
  "documento",
  "cpf_cnpj",
  "remetente_destinatario",
  "historico",
  "saldo",
  "tipo_pix",
  "situacao",
  "cred_dev",
  "hora",
] as const;

/** Obrigatório em cada PDF da sessão. */
export const EXTRATO_PER_PDF_REQUIRED_CAMPOS = ["data", "valor"] as const;

/** Obrigatório na união de todos os PDFs (≥1 extrato cobre). */
export const EXTRATO_SESSION_REQUIRED_CAMPOS = ["remetente_destinatario", "historico", "documento"] as const;

export function extratoColumnMapHasCampo(map: ExtratoColumnMap, campo: string): boolean {
  return map.colunas.some((c) => c.campo === campo);
}

function hasCampo(map: ExtratoColumnMap, campo: string): boolean {
  return extratoColumnMapHasCampo(map, campo);
}

/** Um mapa cobre campo de sessão (ex.: tipo_pix conta como historico em extrato PIX). */
export function extratoSessionCampoSatisfiedByMap(
  map: ExtratoColumnMap,
  campo: (typeof EXTRATO_SESSION_REQUIRED_CAMPOS)[number],
): boolean {
  if (hasCampo(map, campo)) {
    return true;
  }
  if (campo === "historico" && hasCampo(map, "tipo_pix")) {
    return true;
  }
  if (campo === "documento" && hasCampo(map, "tipo_pix")) {
    return true;
  }
  return false;
}

function sessionUnionHasCampo(
  maps: ExtratoColumnMap[],
  campo: (typeof EXTRATO_SESSION_REQUIRED_CAMPOS)[number],
): boolean {
  return maps.some((map) => extratoSessionCampoSatisfiedByMap(map, campo));
}

function validateExtratoColumnMapStructure(
  map: ExtratoColumnMap,
): { ok: true } | { ok: false; message: string } {
  if (map.paginaReferencia !== 1) {
    return { ok: false, message: "paginaReferencia deve ser 1" };
  }
  for (const col of map.colunas) {
    if (!Number.isInteger(col.colunaIndex) || col.colunaIndex < 0) {
      return { ok: false, message: `colunaIndex inválido para ${col.campo}` };
    }
  }
  return { ok: true };
}

function validateExtratoColumnMapDirecao(
  map: ExtratoColumnMap,
): { ok: true } | { ok: false; message: string } {
  if (map.colunaDirecaoDetectada === true) {
    if (!hasCampo(map, "direcao")) {
      return { ok: false, message: "Mapeie a coluna direcao" };
    }
    return { ok: true };
  }
  const temDirecao = hasCampo(map, "direcao") || map.inferirDirecaoDoValor === true;
  if (!temDirecao) {
    return { ok: false, message: "Mapeie direcao ou marque inferir do valor" };
  }
  return { ok: true };
}

/** Valida mapa de um único PDF: data, valor e direção. */
export function validateExtratoColumnMapPerPdf(
  map: ExtratoColumnMap,
): { ok: true } | { ok: false; message: string } {
  const structure = validateExtratoColumnMapStructure(map);
  if (!structure.ok) {
    return structure;
  }
  if (!hasCampo(map, "data")) {
    return { ok: false, message: "Mapeie a coluna data" };
  }
  if (!hasCampo(map, "valor")) {
    return { ok: false, message: "Mapeie a coluna valor" };
  }
  return validateExtratoColumnMapDirecao(map);
}

/** Valida união da sessão: remetente_destinatario, historico e documento em ≥1 extrato. */
export function validateExtratoColumnMapsSession(
  maps: ExtratoColumnMap[],
): { ok: true } | { ok: false; message: string } {
  if (maps.length === 0) {
    return { ok: true };
  }
  for (const campo of EXTRATO_SESSION_REQUIRED_CAMPOS) {
    if (!sessionUnionHasCampo(maps, campo)) {
      return {
        ok: false,
        message: `Falta mapear ${campo} em pelo menos um extrato`,
      };
    }
  }
  return { ok: true };
}

/** Validação completa de um mapa isolado (1 PDF com todos os campos). */
export function validateExtratoColumnMap(
  map: ExtratoColumnMap,
): { ok: true } | { ok: false; message: string } {
  const perPdf = validateExtratoColumnMapPerPdf(map);
  if (!perPdf.ok) {
    return perPdf;
  }
  return validateExtratoColumnMapsSession([map]);
}

export function parseExtratoColumnMap(raw: unknown): ExtratoColumnMap | null {
  if (raw == null || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (o.paginaReferencia !== 1) {
    return null;
  }
  if (!Array.isArray(o.colunas)) {
    return null;
  }
  const colunas: ExtratoColumnMapEntry[] = [];
  for (const item of o.colunas) {
    if (item == null || typeof item !== "object") {
      return null;
    }
    const e = item as Record<string, unknown>;
    const campo = String(e.campo ?? "").trim();
    if (!campo || campo === "nome") {
      return null;
    }
    const colunaIndex = Number(e.colunaIndex);
    if (!Number.isInteger(colunaIndex) || colunaIndex < 0) {
      return null;
    }
    colunas.push({
      campo,
      label: e.label != null ? String(e.label) : undefined,
      colunaIndex,
      headerLabel: e.headerLabel != null ? String(e.headerLabel) : undefined,
      xInicio: typeof e.xInicio === "number" ? e.xInicio : undefined,
      xFim: typeof e.xFim === "number" ? e.xFim : undefined,
    });
  }
  const map: ExtratoColumnMap = {
    paginaReferencia: 1,
    inferirDirecaoDoValor: o.inferirDirecaoDoValor === true,
    colunaDirecaoDetectada: o.colunaDirecaoDetectada === true,
    colunas,
  };
  return validateExtratoColumnMapPerPdf(map).ok ? map : null;
}

function labelFor(entry: ExtratoColumnMapEntry): string {
  if (entry.label?.trim()) {
    return entry.label.trim();
  }
  if (entry.headerLabel?.trim()) {
    return entry.headerLabel.trim();
  }
  return entry.campo;
}

export function buildExtratoColumnPromptHint(map: ExtratoColumnMap): string {
  const lines = map.colunas
    .slice()
    .sort((a, b) => a.colunaIndex - b.colunaIndex)
    .map((c) => {
      let line = `coluna ${c.colunaIndex} = ${c.campo}`;
      if (c.headerLabel) {
        line += ` (rótulo "${c.headerLabel}")`;
      }
      if (c.label && c.label !== c.campo) {
        line += ` — "${labelFor(c)}"`;
      }
      if (c.xInicio != null && c.xFim != null) {
        line += ` [faixa horizontal ${Math.round(c.xInicio * 100)}%-${Math.round(c.xFim * 100)}% da página]`;
      }
      return line;
    });
  const direcao =
    map.inferirDirecaoDoValor === true
      ? "Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor."
      : hasCampo(map, "direcao")
        ? "Use a coluna mapeada como direcao."
        : "";
  const docHint = hasCampo(map, "documento")
    ? "A coluna documento é o número de documento/lançamento do extrato bancário (ex.: Caixa Econômica), não CPF/CNPJ."
    : "";
  const cpfHint = hasCampo(map, "cpf_cnpj")
    ? "A coluna cpf_cnpj contém CPF ou CNPJ da contraparte quando o extrato tiver coluna dedicada."
    : "";
  const campoHints = [docHint, cpfHint].filter(Boolean).join(" ");

  return (
    "Layout de colunas informado pelo operador (índice 0 = esquerda). " +
    "Aplique em todas as páginas deste extrato:\n" +
    lines.join("\n") +
    (direcao ? `\n${direcao}` : "") +
    (campoHints ? `\n${campoHints}` : "")
  );
}

export function slugCustomField(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `custom_${base || "campo"}`;
}
