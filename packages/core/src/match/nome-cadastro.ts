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
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  const [small, big] =
    tokensA.size <= tokensB.size ? [tokensA, tokensB] : [tokensB, tokensA];
  return [...small].every((token) => big.has(token));
}
