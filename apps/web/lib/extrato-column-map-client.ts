export function clientFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function resolveColumnIndexFromClick(params: {
  clickXNorm: number;
  columnCount: number;
}): number {
  const { clickXNorm, columnCount } = params;
  const n = Math.max(1, columnCount);
  const idx = Math.floor(Math.max(0, Math.min(1, clickXNorm)) * n);
  return Math.min(idx, n - 1);
}

/** Faixa horizontal normalizada para a coluna N em uma grade de `columnCount` colunas. */
export function boundsForColumnIndex(
  colunaIndex: number,
  columnCount: number,
): { xInicio: number; xFim: number } {
  const n = Math.max(1, columnCount);
  const i = Math.max(0, Math.min(n - 1, colunaIndex));
  return {
    xInicio: i / n,
    xFim: (i + 1) / n,
  };
}

/** Faixa estreita em torno do clique (ajuste fino no PDF). */
export function boundsFromClickNorm(
  clickXNorm: number,
  columnCount: number,
  halfWidth = 0.04,
): { colunaIndex: number; xInicio: number; xFim: number } {
  const colunaIndex = resolveColumnIndexFromClick({ clickXNorm, columnCount });
  const grid = boundsForColumnIndex(colunaIndex, columnCount);
  const center = Math.max(0, Math.min(1, clickXNorm));
  return {
    colunaIndex,
    xInicio: Math.max(grid.xInicio, center - halfWidth),
    xFim: Math.min(grid.xFim, center + halfWidth),
  };
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export type TextItemLike = {
  str: string;
  transform: number[];
};

const CLUSTER_GAP_PX = 20;

function clusterXs(items: TextItemLike[]): Array<{ x: number; label: string }> {
  const sorted = items
    .map((item) => ({
      x: item.transform[4] ?? 0,
      label: item.str.trim(),
    }))
    .filter((item) => item.label.length > 0)
    .sort((a, b) => a.x - b.x);

  const clusters: Array<{ x: number; label: string }> = [];
  for (const item of sorted) {
    const last = clusters.at(-1);
    if (last == null || item.x - last.x > CLUSTER_GAP_PX) {
      clusters.push({ x: item.x, label: item.label });
    } else {
      last.label = `${last.label} ${item.label}`.trim();
    }
  }
  return clusters;
}

/** Map click to column index using pdf.js text items near the header row. */
export function resolveColumnFromTextItems(
  items: TextItemLike[],
  clickX: number,
  clickY: number,
): { colunaIndex: number; headerLabel?: string } {
  const near = items.filter((item) => {
    const y = item.transform[5] ?? 0;
    return Math.abs(y - clickY) <= 14;
  });
  const rowItems = near.length > 0 ? near : items;
  const clusters = clusterXs(rowItems);
  if (clusters.length === 0) {
    return { colunaIndex: 0 };
  }

  let bestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < clusters.length; i += 1) {
    const dist = Math.abs(clusters[i]!.x - clickX);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return {
    colunaIndex: bestIdx,
    headerLabel: clusters[bestIdx]?.label,
  };
}

const CAMPOS_AUTO_MAPS = [
  { campo: "data", keywords: ["data", "dt", "dt.", "movimento", "vencimento"] },
  { campo: "valor", keywords: ["valor", "val", "vlr", "valor (r$)", "valor r$", "vlr (r$)", "vlr r$"] },
  { campo: "documento", keywords: ["documento", "doc", "doc.", "nr. doc", "num doc", "numero doc", "nr doc", "nº documento", "no documento"] },
  { campo: "cpf_cnpj", keywords: ["cpf", "cnpj", "cpf/cnpj", "cpf cnpj", "cpf.cnpj", "cpf_cnpj"] },
  {
    campo: "remetente_destinatario",
    keywords: [
      "remetente",
      "destinatario",
      "destinatário",
      "remetente/destinatario",
      "favorecido",
      "nome",
      "cliente",
      "origem",
      "destino",
      "razao social",
      "razão social",
    ],
  },
  { campo: "historico", keywords: ["historico", "desc", "descricao", "historico/descricao", "historico / descricao", "descrição", "histórico"] },
  { campo: "saldo", keywords: ["saldo", "sald", "saldo (r$)", "saldo r$"] },
  { campo: "situacao", keywords: ["situacao", "situação", "status", "estado"] },
  { campo: "hora", keywords: ["hora", "hor.", "time"] },
  {
    campo: "direcao",
    keywords: [
      "cred",
      "dev",
      "d/c",
      "débito",
      "crédito",
      "debito",
      "credito",
      "cred/dev",
    ],
  },
];

const DIRECAO_AUTO_MAP = CAMPOS_AUTO_MAPS.find((m) => m.campo === "direcao")!;

function labelMatchesCampo(lower: string, keywords: string[]): boolean {
  return keywords.some(
    (kw) =>
      lower === kw || lower.includes(kw) || lower.startsWith(kw) || lower.endsWith(kw),
  );
}

/** True when header row contains keywords for coluna direcao (D/C, cred/dev, etc.). */
export function detectColunaDirecaoNoCabecalho(items: TextItemLike[]): boolean {
  if (items.length === 0) {
    return false;
  }

  const rowsMap = new Map<number, TextItemLike[]>();
  for (const item of items) {
    const y = Math.round((item.transform[5] ?? 0) / 15) * 15;
    if (!rowsMap.has(y)) {
      rowsMap.set(y, []);
    }
    rowsMap.get(y)!.push(item);
  }

  for (const [, rowItems] of rowsMap.entries()) {
    const clusters = clusterXs(rowItems);
    for (const cluster of clusters) {
      if (labelMatchesCampo(cluster.label.toLowerCase(), DIRECAO_AUTO_MAP.keywords)) {
        return true;
      }
    }
  }
  return false;
}

export function autoDiscoverColumns(
  items: TextItemLike[],
  canvasWidth: number,
): Array<{
  campo: string;
  colunaIndex: number;
  headerLabel?: string;
  xInicio?: number;
  xFim?: number;
}> {
  if (items.length === 0 || canvasWidth <= 0) {
    return [];
  }

  const rowsMap = new Map<number, TextItemLike[]>();
  for (const item of items) {
    const y = Math.round((item.transform[5] ?? 0) / 15) * 15;
    if (!rowsMap.has(y)) {
      rowsMap.set(y, []);
    }
    rowsMap.get(y)!.push(item);
  }

  let bestClusters: Array<{ x: number; label: string }> = [];
  let maxScore = -1;

  for (const [, rowItems] of rowsMap.entries()) {
    const clusters = clusterXs(rowItems);
    let score = 0;
    for (const cluster of clusters) {
      const lower = cluster.label.toLowerCase();
      for (const mapping of CAMPOS_AUTO_MAPS) {
        if (labelMatchesCampo(lower, mapping.keywords)) {
          score += 1;
        }
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestClusters = clusters;
    }
  }

  if (maxScore < 2 || bestClusters.length === 0) {
    return [];
  }

  const xNorms = bestClusters.map((c) => c.x / canvasWidth);
  const entries: Array<{
    campo: string;
    colunaIndex: number;
    headerLabel?: string;
    xInicio?: number;
    xFim?: number;
  }> = [];

  for (let i = 0; i < bestClusters.length; i += 1) {
    const cluster = bestClusters[i]!;
    const label = cluster.label;
    const lower = label.toLowerCase();

    let foundCampo: string | null = null;
    for (const mapping of CAMPOS_AUTO_MAPS) {
      if (labelMatchesCampo(lower, mapping.keywords)) {
        foundCampo = mapping.campo;
        break;
      }
    }

    if (foundCampo) {
      const left = i === 0 ? 0 : (xNorms[i - 1]! + xNorms[i]!) / 2;
      const right = i === xNorms.length - 1 ? 1 : (xNorms[i]! + xNorms[i + 1]!) / 2;

      entries.push({
        campo: foundCampo,
        colunaIndex: i,
        headerLabel: label,
        xInicio: clamp01(left),
        xFim: clamp01(right),
      });
    }
  }

  return entries;
}
