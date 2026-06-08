import { normalizeName } from "../normalize";

export type NomeCadastroComparacao = "bate" | "difere" | "indefinido";

const MIN_NOME_LEN = 3;

export function compararNomeCadastro(
  extraido: string,
  cadastro: string,
): NomeCadastroComparacao {
  const a = normalizeName(extraido ?? "");
  const b = normalizeName(cadastro ?? "");
  if (a.length <= MIN_NOME_LEN || b.length <= MIN_NOME_LEN) {
    return "indefinido";
  }
  if (a === b || a.includes(b) || b.includes(a) || isTokenSubset(a, b)) {
    return "bate";
  }
  return "difere";
}

function isTokenSubset(a: string, b: string): boolean {
  const tokensA = a.split(" ").filter(Boolean);
  const tokensB = b.split(" ").filter(Boolean);
  const [small, big] =
    tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  if (tokensMatchWithAbbreviations(small, big)) return true;
  if (small.length === big.length) {
    return tokensMatchWithAbbreviations(big, small);
  }
  return false;
}

/** Single-letter tokens in shorter name match longer tokens starting with that letter. */
function tokensMatchWithAbbreviations(small: string[], big: string[]): boolean {
  const used = new Set<number>();
  for (const token of small) {
    let matched = false;
    for (let i = 0; i < big.length; i++) {
      if (used.has(i)) continue;
      const bigToken = big[i];
      if (bigToken === token) {
        used.add(i);
        matched = true;
        break;
      }
      if (token.length === 1 && bigToken.startsWith(token)) {
        used.add(i);
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}
