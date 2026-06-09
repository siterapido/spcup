import { normalizeName } from "../normalize";

export type CamposExtracao = Partial<Record<string, string | null>>;

const CAMPO_KEYS = [
  "data",
  "valor",
  "direcao",
  "descricao",
  "documento",
  "historico",
  "hora",
  "tipo_pix",
  "situacao",
  "saldo",
  "remetente_destinatario",
] as const;

export type MovimentacaoCamposLike = {
  camposExtracao?: CamposExtracao | null;
  remetenteDestinatario?: string | null;
  nrExtratoBancario?: string | null;
};

function formatValor(raw: unknown): string | undefined {
  if (raw == null) {
    return undefined;
  }
  const num = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
  if (Number.isNaN(num)) {
    return undefined;
  }
  return Math.abs(num).toFixed(2);
}

function buildCamposFromRecord(source: Record<string, unknown>): CamposExtracao {
  const campos: CamposExtracao = {};

  for (const key of CAMPO_KEYS) {
    const raw = source[key];
    if (raw == null) {
      continue;
    }

    if (key === "valor") {
      const formatted = formatValor(raw);
      if (formatted) {
        campos.valor = formatted;
      }
      continue;
    }

    const str = String(raw).trim();
    if (str) {
      campos[key] = str;
    }
  }

  return campos;
}

export function buildCamposExtracaoFromNotebookTx(
  tx: Record<string, unknown>,
): CamposExtracao {
  return buildCamposFromRecord(tx);
}

export function buildCamposExtracaoFromExtratoItem(
  item: Record<string, unknown>,
): CamposExtracao {
  return buildCamposFromRecord(item);
}

export function mergeCamposExtracao(a: CamposExtracao, b: CamposExtracao): CamposExtracao {
  const merged: CamposExtracao = { ...a };

  for (const [key, value] of Object.entries(b)) {
    if (key in merged) {
      continue;
    }
    if (value != null && value !== "") {
      merged[key] = value;
    }
  }

  return merged;
}

export function espelharCamposLegados(campos: CamposExtracao): {
  remetenteDestinatario: string | null;
  nrExtratoBancario: string | null;
} {
  const rd = campos.remetente_destinatario?.trim() ?? "";
  const remetenteDestinatario = rd.length >= 3 ? normalizeName(rd) : null;

  const doc = campos.documento?.trim() ?? "";
  const nrExtratoBancario = doc || null;

  return { remetenteDestinatario, nrExtratoBancario };
}

export function campoExtracao(mov: MovimentacaoCamposLike, key: string): string | null {
  const fromCampos = mov.camposExtracao?.[key];
  if (fromCampos != null && fromCampos !== "") {
    return fromCampos;
  }

  if (key === "remetente_destinatario") {
    return mov.remetenteDestinatario ?? null;
  }

  if (key === "documento") {
    return mov.nrExtratoBancario ?? null;
  }

  return null;
}
