import { normalizeName } from "../normalize";

const PREFIXES = [
  "PIX RECEBIDO",
  "PIX ENVIADO",
  "TED ENVIADA",
  "TED RECEBIDA",
  "TED ENVIADO",
  "TED RECEBIDO",
  "DOC ENVIADO",
  "DOC RECEBIDO",
  "PIX EMITIDO",
  "PIX TRANSF",
  "TRANSF PIX",
  "TED TRANSF",
  "PIX PGTO",
  "PGTO PIX",
  "PIX DEVOLUCAO",
  "PIX DEV",
  "PIX RECEB",
  "PIX ENV",
  "TED RECEB",
  "TED ENV",
  "DOC RECEB",
  "DOC ENV",
];

const PATTERN = new RegExp(`^(?:${PREFIXES.join("|")})\\s*-\\s*(.+)$`, "i");

export function contraparteDoHistorico(historico: string): string | null {
  const match = historico.trim().match(PATTERN);
  if (!match) {
    return null;
  }
  const namePart = match[1]!.trim();
  if (!namePart) {
    return null;
  }
  return normalizeName(namePart);
}
