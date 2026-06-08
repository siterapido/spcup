"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type {
  BboxNorm,
  CampoExtrato,
  OrigemAtributosEvento,
  OrigemEnriquecimentoV1,
  OrigemExtracaoV1,
  OrigemRef,
} from "@spc-up/core/browser";

import { PdfOrigemViewer } from "./pdf-origem-viewer";

const ATRIBUTO_LABELS: Record<string, string> = {
  dataMovimento: "Data",
  valor: "Valor",
  direcao: "Direção",
  pessoa: "Pessoa",
  confianca: "Confiança",
};

const CAMPO_LABELS: Record<CampoExtrato | "linha_inteira", string> = {
  data: "Data no PDF",
  valor: "Valor no PDF",
  direcao: "Direção no PDF",
  cpf: "CPF no PDF",
  cnpj: "CNPJ no PDF",
  nome: "Nome no PDF",
  descricao: "Descrição no PDF",
  linha_inteira: "Linha inteira no PDF",
};

type ViewerState = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
  highlightLabel: string;
  indiceLinha?: number;
};

type LinhaPdf = {
  papel: string;
  descricaoRaw: string;
  nomeArquivo: string | null;
  origemExtracao?: OrigemExtracaoV1 | null;
};

type Row = {
  atributo: string;
  ref: OrigemRef;
  arquivoHint?: string;
};

function detalheOrigem(ref: OrigemRef): string {
  switch (ref.tipo) {
    case "PDF": {
      const campo = CAMPO_LABELS[ref.campo] ?? ref.campo;
      return `${ref.nomeArquivo} · pág. ${ref.pagina} · linha ${ref.indiceLinha} · ${campo}`;
    }
    case "CADASTRO_UF":
      return ref.matchTipo;
    case "CRUZAMENTO_PDF":
      return ref.detalhe ?? ref.regra;
    case "IA_CRUZAMENTO":
      return ref.detalhe ?? `IA ${Math.round(ref.confianca * 100)}%`;
    case "INDISPONIVEL":
      return ref.motivo;
    default:
      return "";
  }
}

function fonteLabel(ref: OrigemRef): string {
  switch (ref.tipo) {
    case "PDF":
      return "PDF";
    case "CADASTRO_UF":
      return "Cadastro UF";
    case "CRUZAMENTO_PDF":
      return "Cruzamento";
    case "IA_CRUZAMENTO":
      return "IA";
    case "INDISPONIVEL":
      return "Indisponível";
    default: {
      const _exhaustive: never = ref;
      return String(_exhaustive);
    }
  }
}

function flattenAtributos(origem: OrigemAtributosEvento): Row[] {
  const rows: Row[] = [];
  for (const [key, refs] of Object.entries(origem) as Array<
    [keyof OrigemAtributosEvento, OrigemRef[] | number]
  >) {
    if (key === "versao" || !Array.isArray(refs)) {
      continue;
    }
    const label = ATRIBUTO_LABELS[key] ?? key;
    const pdfRefs = refs.filter((r): r is Extract<OrigemRef, { tipo: "PDF" }> => r.tipo === "PDF");
    const pdfByArquivo = new Map(
      pdfRefs.map((r) => [r.nomeArquivo, r.nomeArquivo] as const),
    );
    const multiPdf = pdfByArquivo.size > 1;

    refs.forEach((ref, index) => {
      const arquivoHint =
        ref.tipo === "PDF" && multiPdf ? ref.nomeArquivo : undefined;
      const atributo =
        ref.tipo === "PDF" && multiPdf
          ? `${label} (${ref.nomeArquivo})`
          : refs.length > 1 && ref.tipo === "PDF"
            ? `${label} ${index + 1}`
            : label;
      rows.push({ atributo, ref, arquivoHint });
    });
  }
  return rows;
}

function rowsFromLinhasPdf(linhas: LinhaPdf[]): Row[] {
  const rows: Row[] = [];
  for (const linha of linhas) {
    const o = linha.origemExtracao;
    if (!o) {
      continue;
    }
    const papel = linha.papel || "OUTRO";
    const arquivo = linha.nomeArquivo ?? o.nomeArquivo;

    rows.push({
      atributo: `${papel} — linha no extrato`,
      ref: {
        tipo: "PDF",
        movimentacaoId: "",
        arquivoIngestaoId: o.arquivoIngestaoId,
        nomeArquivo: o.nomeArquivo,
        pagina: o.pagina,
        indiceLinha: o.indiceLinha,
        bbox: o.bbox,
        campo: "linha_inteira",
      },
      arquivoHint: arquivo,
    });

    if (o.campos) {
      for (const [campo, loc] of Object.entries(o.campos) as Array<
        [CampoExtrato, NonNullable<OrigemExtracaoV1["campos"]>[CampoExtrato]]
      >) {
        if (!loc) {
          continue;
        }
        rows.push({
          atributo: `${papel} — ${CAMPO_LABELS[campo] ?? campo}`,
          ref: {
            tipo: "PDF",
            movimentacaoId: "",
            arquivoIngestaoId: o.arquivoIngestaoId,
            nomeArquivo: o.nomeArquivo,
            pagina: loc.pagina,
            indiceLinha: loc.indiceLinha,
            bbox: loc.bbox ?? o.bbox,
            campo,
          },
          arquivoHint: arquivo,
        });
      }
    }
  }
  return rows;
}

function openPdfViewer(
  ref: Extract<OrigemRef, { tipo: "PDF" }>,
  atributo: string,
  setViewer: (v: ViewerState) => void,
) {
  setViewer({
    arquivoIngestaoId: ref.arquivoIngestaoId,
    nomeArquivo: ref.nomeArquivo,
    pagina: ref.pagina,
    bbox: ref.bbox,
    highlightLabel: `${atributo} · ${CAMPO_LABELS[ref.campo] ?? ref.campo}`,
    indiceLinha: ref.indiceLinha,
  });
}

type Props = {
  origemAtributos?: OrigemAtributosEvento | null;
  origemExtracao?: OrigemExtracaoV1 | null;
  origemEnriquecimento?: OrigemEnriquecimentoV1 | null;
  /** Linhas do evento (PIX/COMPLETO) para fallback e conferência por arquivo. */
  linhas?: LinhaPdf[];
  /** Texto introdutório opcional (consolidação). */
  compact?: boolean;
};

export function OrigensPanel({
  origemAtributos,
  origemExtracao,
  origemEnriquecimento,
  linhas = [],
  compact = false,
}: Props) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const rows = useMemo(() => {
    let result: Row[] = origemAtributos ? flattenAtributos(origemAtributos) : [];

    if (result.length === 0 && origemExtracao) {
      result = [
        {
          atributo: "Extrato",
          ref: {
            tipo: "PDF",
            movimentacaoId: "",
            arquivoIngestaoId: origemExtracao.arquivoIngestaoId,
            nomeArquivo: origemExtracao.nomeArquivo,
            pagina: origemExtracao.pagina,
            indiceLinha: origemExtracao.indiceLinha,
            bbox: origemExtracao.bbox,
            campo: "linha_inteira",
          },
        },
      ];
    }

    const onlyIndisponivel =
      result.length > 0 && result.every((r) => r.ref.tipo === "INDISPONIVEL");
    const linhaRows = rowsFromLinhasPdf(linhas);
    if (linhaRows.length > 0 && (result.length === 0 || onlyIndisponivel)) {
      result = linhaRows;
    } else if (linhaRows.length > 0) {
      const pdfKeys = new Set(
        result
          .filter((r): r is Row & { ref: Extract<OrigemRef, { tipo: "PDF" }> } => r.ref.tipo === "PDF")
          .map((r) => `${r.ref.arquivoIngestaoId}:${r.ref.pagina}:${r.ref.indiceLinha}:${r.ref.campo}`),
      );
      for (const lr of linhaRows) {
        if (lr.ref.tipo !== "PDF") {
          continue;
        }
        const key = `${lr.ref.arquivoIngestaoId}:${lr.ref.pagina}:${lr.ref.indiceLinha}:${lr.ref.campo}`;
        if (!pdfKeys.has(key)) {
          result.push(lr);
        }
      }
    }

    result = [
      ...result,
      ...(origemEnriquecimento?.refs ?? []).map((ref) => ({
        atributo: "Enriquecimento",
        ref,
      })),
    ];

    return result;
  }, [origemAtributos, origemExtracao, origemEnriquecimento, linhas]);

  if (
    rows.length === 0 &&
    !origemAtributos &&
    !origemExtracao &&
    !origemEnriquecimento &&
    linhas.length === 0
  ) {
    return (
      <p className="text-sm text-muted">
        Origem no PDF indisponível (ingestão anterior a esta versão).
      </p>
    );
  }

  const hasPdfAction = rows.some((r) => r.ref.tipo === "PDF");

  return (
    <div className="space-y-2">
      <div>
        <p className={`font-medium text-slate-800 ${compact ? "text-xs" : "text-sm"}`}>
          Conferência no PDF
        </p>
        <p className={`text-muted ${compact ? "text-[11px]" : "text-xs"} mt-0.5`}>
          Cada linha indica o arquivo, a página e o trecho destacado no documento.
          {hasPdfAction ? " Clique em «Ver no PDF» para abrir com o destaque." : ""}
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border-default">
        <table className={`w-full ${compact ? "text-xs" : "text-sm"}`}>
          <thead>
            <tr className="border-b border-border-default bg-muted/30 text-left">
              <th className="px-3 py-2">Dado</th>
              <th className="px-3 py-2">Fonte</th>
              <th className="px-3 py-2">Local no documento</th>
              <th className="px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.atributo}-${i}`} className="border-b border-border-default/60 align-top">
                <td className="px-3 py-2 font-medium text-slate-800">{row.atributo}</td>
                <td className="px-3 py-2">{fonteLabel(row.ref)}</td>
                <td className="px-3 py-2 text-muted max-w-xs">{detalheOrigem(row.ref)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.ref.tipo === "PDF" ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-primary underline"
                      onClick={() => {
                        if (row.ref.tipo === "PDF") {
                          openPdfViewer(row.ref, row.atributo, setViewer);
                        }
                      }}
                    >
                      Ver no PDF
                    </button>
                  ) : row.ref.tipo === "CADASTRO_UF" ? (
                    <Link href="/pessoas" className="text-sm font-medium underline">
                      Cadastro
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewer && (
        <PdfOrigemViewer
          open
          onClose={() => setViewer(null)}
          arquivoIngestaoId={viewer.arquivoIngestaoId}
          nomeArquivo={viewer.nomeArquivo}
          pagina={viewer.pagina}
          bbox={viewer.bbox}
          highlightLabel={viewer.highlightLabel}
          indiceLinha={viewer.indiceLinha}
        />
      )}
    </div>
  );
}
