"use client";

import Link from "next/link";
import { useState } from "react";

import type {
  BboxNorm,
  OrigemAtributosEvento,
  OrigemEnriquecimentoV1,
  OrigemExtracaoV1,
  OrigemRef,
} from "@spc-up/core";

import { PdfOrigemViewer } from "./pdf-origem-viewer";

const ATRIBUTO_LABELS: Record<string, string> = {
  dataMovimento: "Data",
  valor: "Valor",
  direcao: "Direção",
  pessoa: "Pessoa",
  confianca: "Confiança",
};

type ViewerState = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  bbox?: BboxNorm;
};

function detalheOrigem(ref: OrigemRef): string {
  switch (ref.tipo) {
    case "PDF":
      return `${ref.nomeArquivo} · pág. ${ref.pagina} · linha ${ref.indiceLinha}`;
    case "CADASTRO_UF":
      return ref.matchTipo;
    case "CRUZAMENTO_PDF":
      return ref.regra;
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

type Row = { atributo: string; ref: OrigemRef };

function flattenAtributos(origem: OrigemAtributosEvento): Row[] {
  const rows: Row[] = [];
  for (const [key, refs] of Object.entries(origem) as Array<
    [keyof OrigemAtributosEvento, OrigemRef[] | number]
  >) {
    if (key === "versao" || !Array.isArray(refs)) {
      continue;
    }
    for (const ref of refs) {
      rows.push({ atributo: ATRIBUTO_LABELS[key] ?? key, ref });
    }
  }
  return rows;
}

type Props = {
  origemAtributos?: OrigemAtributosEvento | null;
  origemExtracao?: OrigemExtracaoV1 | null;
  origemEnriquecimento?: OrigemEnriquecimentoV1 | null;
};

export function OrigensPanel({
  origemAtributos,
  origemExtracao,
  origemEnriquecimento,
}: Props) {
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  let rows: Row[] = origemAtributos ? flattenAtributos(origemAtributos) : [];

  if (!origemAtributos && !origemExtracao && !origemEnriquecimento) {
    return (
      <p className="text-sm text-muted">Origem indisponível (ingestão anterior).</p>
    );
  }

  if (rows.length === 0 && origemExtracao) {
    rows = [
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

  rows = [
    ...rows,
    ...(origemEnriquecimento?.refs ?? []).map((ref) => ({
      atributo: "Enriquecimento",
      ref,
    })),
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Origem por campo</p>
      <div className="overflow-x-auto rounded-md border border-border-default">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-default bg-muted/30 text-left">
              <th className="px-3 py-2">Atributo</th>
              <th className="px-3 py-2">Fonte</th>
              <th className="px-3 py-2">Detalhe</th>
              <th className="px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.atributo}-${i}`} className="border-b border-border-default/60">
                <td className="px-3 py-2">{row.atributo}</td>
                <td className="px-3 py-2">{fonteLabel(row.ref)}</td>
                <td className="px-3 py-2 text-muted">{detalheOrigem(row.ref)}</td>
                <td className="px-3 py-2">
                  {row.ref.tipo === "PDF" ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-primary underline"
                      onClick={() => {
                        const pdf = row.ref;
                        if (pdf.tipo !== "PDF") {
                          return;
                        }
                        setViewer({
                          arquivoIngestaoId: pdf.arquivoIngestaoId,
                          nomeArquivo: pdf.nomeArquivo,
                          pagina: pdf.pagina,
                          bbox: pdf.bbox,
                        });
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
        />
      )}
    </div>
  );
}
