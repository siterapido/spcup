import { stripDocumentsFromDescricao } from "../match/rules";
import { normalizeName } from "../normalize";

export function cleanDescricao(descricaoRaw: string): string {
  if (!descricaoRaw) return "";
  return normalizeName(stripDocumentsFromDescricao(descricaoRaw));
}
