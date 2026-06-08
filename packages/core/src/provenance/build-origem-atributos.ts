import type { ConsolidacaoEventDraft, MovimentacaoCandidate } from "../consolidacao/types";
import { hasCpfInDescricao } from "../match/rules";
import type { CampoExtrato, OrigemAtributosEvento, OrigemRef } from "./types";

function pdfRef(
  m: MovimentacaoCandidate,
  campo: CampoExtrato | "linha_inteira",
): OrigemRef | null {
  const o = m.origemExtracao;
  if (!o) {
    return null;
  }
  const campoOrig =
    campo !== "linha_inteira" ? o.campos?.[campo] : undefined;
  return {
    tipo: "PDF",
    movimentacaoId: m.id,
    arquivoIngestaoId: o.arquivoIngestaoId,
    nomeArquivo: o.nomeArquivo,
    pagina: campoOrig?.pagina ?? o.pagina,
    indiceLinha: campoOrig?.indiceLinha ?? o.indiceLinha,
    bbox: campoOrig?.bbox ?? o.bbox,
    campo,
  };
}

function indisponivel(motivo: string): OrigemRef {
  return { tipo: "INDISPONIVEL", motivo };
}

function pdfOrIndisponivel(m: MovimentacaoCandidate, campo: CampoExtrato): OrigemRef {
  return pdfRef(m, campo) ?? indisponivel("ingestao_anterior");
}

export function regraFromJustificativa(justificativa: string): string {
  if (justificativa.includes("Mesmo CPF")) {
    return "MESMA_DATA_VALOR_CPF";
  }
  if (justificativa.includes("CPF no extrato completo")) {
    return "CPF_COMPLETO_NOME_CADASTRO";
  }
  if (justificativa.includes("cadastro")) {
    return "NOME_CADASTRO_UF";
  }
  if (justificativa.includes("descrição equivalente")) {
    return "MESMA_DATA_VALOR_NOME";
  }
  if (justificativa.includes("CPF na linha")) {
    return "CPF_LINHA_CADASTRO";
  }
  return "MESMA_DATA_VALOR_DIRECAO";
}

/** Build per-attribute provenance for a consolidation event draft. */
export function buildOrigemAtributos(
  draft: Omit<ConsolidacaoEventDraft, "origemAtributos">,
  movById: Map<string, MovimentacaoCandidate>,
): OrigemAtributosEvento {
  const linhaMovs = draft.linhas
    .map((l) => movById.get(l.movimentacaoId))
    .filter((m): m is MovimentacaoCandidate => m != null);

  const dataMovimento: OrigemRef[] = linhaMovs.map((m) => pdfOrIndisponivel(m, "data"));
  const valor: OrigemRef[] = linhaMovs.map((m) => pdfOrIndisponivel(m, "valor"));
  const direcao: OrigemRef[] = linhaMovs.map((m) => pdfOrIndisponivel(m, "direcao"));

  const pessoa: OrigemRef[] = [];
  const confianca: OrigemRef[] = [];

  if (linhaMovs.length >= 2) {
    const regra = regraFromJustificativa(draft.justificativa);
    pessoa.push({
      tipo: "CRUZAMENTO_PDF",
      movimentacaoIds: linhaMovs.map((m) => m.id),
      regra,
      detalhe: draft.justificativa,
    });
    confianca.push({
      tipo: "CRUZAMENTO_PDF",
      movimentacaoIds: linhaMovs.map((m) => m.id),
      regra,
      detalhe: draft.justificativa,
    });
    const withCpf = linhaMovs.find((m) => extractCpfFromMov(m));
    if (withCpf) {
      const pdf = pdfRef(withCpf, "cpf");
      if (pdf) {
        pessoa.push(pdf);
      }
    }
  } else if (linhaMovs.length === 1) {
    const m = linhaMovs[0]!;
    const pdfCpf = pdfRef(m, "cpf");
    if (pdfCpf) {
      pessoa.push(pdfCpf);
    } else {
      pessoa.push(pdfOrIndisponivel(m, "nome"));
    }
  }

  if (draft.pessoaFisicaId || draft.pessoaJuridicaId) {
    const matchTipo =
      draft.justificativa.includes("Nome único") ||
      draft.justificativa.includes("nome alinhado")
        ? "NOME_CADASTRO"
        : "CPF_CADASTRO";
    pessoa.push({
      tipo: "CADASTRO_UF",
      pessoaFisicaId: draft.pessoaFisicaId,
      pessoaJuridicaId: draft.pessoaJuridicaId,
      matchTipo,
    });
  }

  if (pessoa.length === 0) {
    pessoa.push(indisponivel("sem_vinculo"));
  }

  if (confianca.length === 0) {
    confianca.push({
      tipo: "CRUZAMENTO_PDF",
      movimentacaoIds: linhaMovs.map((m) => m.id),
      regra: regraFromJustificativa(draft.justificativa),
      detalhe: `confianca=${draft.confianca}`,
    });
  }

  return {
    versao: 1,
    dataMovimento,
    valor,
    direcao,
    pessoa,
    confianca,
  };
}

function extractCpfFromMov(m: MovimentacaoCandidate): boolean {
  if (m.cpfExtraido) {
    return true;
  }
  return hasCpfInDescricao(m.descricaoRaw);
}
