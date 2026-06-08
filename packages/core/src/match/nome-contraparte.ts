import { normalizeName } from "../normalize";
import {
  cleanNomeSugestao,
  extractDocumentCandidates,
  findCnpjInDescricao,
  findCpfInDescricao,
} from "./rules";

export type OrigemNomeInput = {
  descricaoRaw: string;
  papel?: string;
};

const MIN_NOME_LEN = 3;

export function extractNomeContraparte(descricaoRaw: string): string {
  const doc =
    findCpfInDescricao(descricaoRaw) ?? findCnpjInDescricao(descricaoRaw) ?? "";
  const cleaned = cleanNomeSugestao(descricaoRaw, doc);
  return normalizeName(cleaned);
}

export function isNomeContraparteVazio(nome: string | null | undefined): boolean {
  return (nome ?? "").trim().length < MIN_NOME_LEN;
}

export function deriveNomeContraparte(origens: OrigemNomeInput[]): string {
  const pix = origens.find((o) => o.papel === "PIX");
  const completo = origens.find((o) => o.papel === "COMPLETO");

  const nomePix = pix ? extractNomeContraparte(pix.descricaoRaw) : "";
  const nomeCompleto = completo
    ? extractNomeContraparte(completo.descricaoRaw)
    : "";

  const completoTemDoc =
    !!completo &&
    extractDocumentCandidates(completo.descricaoRaw).length > 0;

  if (!isNomeContraparteVazio(nomePix) && completoTemDoc) {
    return nomePix;
  }
  if (!isNomeContraparteVazio(nomeCompleto)) {
    return nomeCompleto;
  }
  if (!isNomeContraparteVazio(nomePix)) {
    return nomePix;
  }

  let best = "";
  for (const o of origens) {
    const n = extractNomeContraparte(o.descricaoRaw);
    if (n.length > best.length) {
      best = n;
    }
  }
  return best;
}

export function resolveNomeEffective(
  persistido: string | null | undefined,
  origens: OrigemNomeInput[],
): string {
  if (persistido && !isNomeContraparteVazio(persistido)) {
    return normalizeName(persistido);
  }
  return deriveNomeContraparte(origens);
}
