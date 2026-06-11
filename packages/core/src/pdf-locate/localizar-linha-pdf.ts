import { compararNomeCadastro } from "../match/nome-cadastro";
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
  return [`${dd}/${mm}/${yyyy}`, `${dd}/${mm}/${yy}`, `${dd}/${mm}`];
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

function linhaContemDocumento(texto: string, documento: string): boolean {
  const digits = documento.replace(/\D/g, "");
  if (digits.length < 4) return false;
  return texto.replace(/\D/g, "").includes(digits);
}

function linhaContemHora(texto: string, hora: string): boolean {
  const hhmm = hora.match(/^(\d{1,2}):(\d{2})/);
  if (!hhmm) return false;
  return texto.includes(`${hhmm[1]!.padStart(2, "0")}:${hhmm[2]}`);
}

function textoBusca(input: LocalizarLinhaPdfInput): string {
  return [input.remetenteDestinatario, input.descricaoRaw]
    .filter((s) => s != null && s.trim() !== "")
    .join(" ");
}

function scoreLinha(
  linha: LinhaPdfAgrupada,
  input: LocalizarLinhaPdfInput,
  valorPatterns: string[],
  dataPatterns: string[],
): number {
  const hasValor = linhaContemValor(linha.texto, valorPatterns);
  const hasData = linhaContemData(linha.texto, dataPatterns);
  const docDigits = input.documento?.replace(/\D/g, "") ?? "";
  const hasDocumento =
    docDigits.length >= 4 &&
    linhaContemDocumento(linha.texto, input.documento!);

  /** Extrato completo Caixa: valor costuma ficar fora da linha de documento/histórico */
  const docLed = hasDocumento && hasData;
  const valorLed = hasValor && (hasData || input.relaxarDataNaLinha);

  if (!docLed && !valorLed) {
    return -1;
  }

  let score = docLed ? 25 : hasData ? 10 : 1;
  if (hasValor) score += 5;

  const busca = textoBusca(input);
  score += tokenOverlap(linha.texto, busca) * 5;

  if (input.remetenteDestinatario?.trim()) {
    const nomeCmp = compararNomeCadastro(
      linha.texto,
      input.remetenteDestinatario,
    );
    if (nomeCmp === "bate") score += 50;
    else if (nomeCmp === "difere") return -1;
  }

  if (input.documento?.trim()) {
    if (linhaContemDocumento(linha.texto, input.documento)) {
      score += 40;
    } else if (!input.relaxarDataNaLinha) {
      score -= 5;
    }
  }

  if (input.hora?.trim() && linhaContemHora(linha.texto, input.hora)) {
    score += 15;
  }

  return score;
}

export function localizarLinhaPdf(
  input: LocalizarLinhaPdfInput,
): LocalizarLinhaPdfResult {
  const valorNum = parseValorNumerico(input.valor);
  if (valorNum === null) {
    return { encontrado: false, motivo: "Valor inválido" };
  }

  const valorPatterns = [...new Set(formatBrValor(valorNum))];
  const dataPatterns = formatDatasBr(input.dataMovimento);
  if (dataPatterns.length === 0) {
    return { encontrado: false, motivo: "Data inválida" };
  }

  let melhorGlobal: LinhaPdfAgrupada | null = null;
  let melhorPagina = 0;
  let melhorScore = -1;

  for (const pag of input.paginas) {
    const linhas = agruparItensEmLinhas(pag.itens);

    for (const linha of linhas) {
      const score = scoreLinha(linha, input, valorPatterns, dataPatterns);
      if (score > melhorScore) {
        melhorScore = score;
        melhorGlobal = linha;
        melhorPagina = pag.pagina;
      }
    }
  }

  if (!melhorGlobal || melhorScore < 1) {
    return {
      encontrado: false,
      motivo: "Nenhuma linha com valor e data na mesma linha",
    };
  }

  if (input.remetenteDestinatario?.trim()) {
    const nomeCmp = compararNomeCadastro(
      melhorGlobal.texto,
      input.remetenteDestinatario,
    );
    if (nomeCmp === "difere") {
      return {
        encontrado: false,
        motivo: "Linhas com valor encontradas, mas nenhuma com o remetente esperado",
      };
    }
  }

  return {
    encontrado: true,
    pagina: melhorPagina,
    bbox: melhorGlobal.bbox,
    confianca: "estimada",
  };
}
