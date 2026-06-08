import { stripDocumentsFromDescricao } from "../match/document-in-text";
import type { BboxNorm } from "../provenance/types";
import type {
  LinhaPdfAgrupada,
  LocalizarLinhaPdfInput,
  LocalizarLinhaPdfResult,
  PdfTextItem,
} from "./types";

function unionBbox(itens: PdfTextItem[]): BboxNorm {
  const xs = itens.map((i) => i.x);
  const ys = itens.map((i) => i.y);
  const rights = itens.map((i) => i.x + i.width);
  const bottoms = itens.map((i) => i.y + i.height);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...rights) - x;
  const h = Math.max(...bottoms) - y;
  return { x, y, w, h };
}

export function agruparItensEmLinhas(
  itens: PdfTextItem[],
  toleranciaY = 0.02,
): LinhaPdfAgrupada[] {
  if (itens.length === 0) return [];

  const sorted = [...itens].sort((a, b) => a.y - b.y || a.x - b.x);
  const clusters: PdfTextItem[][] = [];
  let current: PdfTextItem[] = [sorted[0]!];
  let clusterY = sorted[0]!.y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]!;
    if (Math.abs(item.y - clusterY) <= toleranciaY) {
      current.push(item);
    } else {
      clusters.push(current);
      current = [item];
      clusterY = item.y;
    }
  }
  clusters.push(current);

  return clusters.map((cluster) => {
    const ordered = [...cluster].sort((a, b) => a.x - b.x);
    return {
      texto: ordered.map((i) => i.str).join(" "),
      bbox: unionBbox(ordered),
      itens: ordered,
    };
  });
}

function parseValorNumerico(valor: string): number | null {
  const cleaned = valor.replace(/R\$\s*/gi, "").trim();
  if (!cleaned) return null;

  const br = /^(\d{1,3}(?:\.\d{3})*),(\d{2})$/.exec(cleaned);
  if (br) {
    return Number(br[1]!.replace(/\./g, "") + "." + br[2]);
  }

  const dot = /^(\d+)(?:\.(\d{2}))?$/.exec(cleaned);
  if (dot) {
    return dot[2] !== undefined
      ? Number(`${dot[1]}.${dot[2]}`)
      : Number(dot[1]);
  }

  const comma = /^(\d+),(\d{2})$/.exec(cleaned);
  if (comma) {
    return Number(`${comma[1]}.${comma[2]}`);
  }

  const n = Number(cleaned.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatBrValor(n: number): string[] {
  const [intPart, decPart = "00"] = n.toFixed(2).split(".");
  const withThousands = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const plainInt = intPart!;
  const dotDecimal = `${plainInt}.${decPart}`;
  const commaDecimal = `${plainInt},${decPart}`;
  const brDecimal = `${withThousands},${decPart}`;

  return [
    brDecimal,
    commaDecimal,
    dotDecimal,
    `R$ ${brDecimal}`,
    `R$ ${commaDecimal}`,
    `R$ ${dotDecimal}`,
    `R$${brDecimal}`,
    `R$${dotDecimal}`,
  ];
}

function formatDatasBr(isoDate: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return [];
  const [, year, month, day] = m;
  const dd = day!;
  const mm = month!;
  const yyyy = year!;
  const yy = yyyy.slice(-2);
  return [`${dd}/${mm}/${yyyy}`, `${dd}/${mm}/${yy}`];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 1);
}

function tokenOverlap(lineText: string, descricaoRaw: string): number {
  const descTokens = new Set(
    tokenize(stripDocumentsFromDescricao(descricaoRaw)),
  );
  if (descTokens.size === 0) return 0;
  const lineTokens = tokenize(lineText);
  let overlap = 0;
  for (const t of lineTokens) {
    if (descTokens.has(t)) overlap++;
  }
  return overlap;
}

function linhaContemValor(texto: string, valorPatterns: string[]): boolean {
  return valorPatterns.some((p) => texto.includes(p));
}

function linhaContemData(texto: string, dataPatterns: string[]): boolean {
  return dataPatterns.some((p) => texto.includes(p));
}

export function localizarLinhaPdf(
  input: LocalizarLinhaPdfInput,
): LocalizarLinhaPdfResult {
  const valorNum = parseValorNumerico(input.valor);
  if (valorNum === null) {
    return { encontrado: false, motivo: "Valor inválido" };
  }

  const valorPatterns = formatBrValor(valorNum);
  const dataPatterns = formatDatasBr(input.dataMovimento);
  if (dataPatterns.length === 0) {
    return { encontrado: false, motivo: "Data inválida" };
  }

  for (const pag of input.paginas) {
    const linhas = agruparItensEmLinhas(pag.itens);
    const candidatas = linhas.filter(
      (l) =>
        linhaContemValor(l.texto, valorPatterns) &&
        linhaContemData(l.texto, dataPatterns),
    );

    if (candidatas.length === 0) continue;

    let melhor = candidatas[0]!;
    let melhorScore = tokenOverlap(melhor.texto, input.descricaoRaw);

    for (let i = 1; i < candidatas.length; i++) {
      const cand = candidatas[i]!;
      const score = tokenOverlap(cand.texto, input.descricaoRaw);
      if (score > melhorScore) {
        melhor = cand;
        melhorScore = score;
      }
    }

    return {
      encontrado: true,
      pagina: pag.pagina,
      bbox: melhor.bbox,
      confianca: "estimada",
    };
  }

  return {
    encontrado: false,
    motivo: "Nenhuma linha com valor e data na mesma linha",
  };
}
