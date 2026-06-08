import type { ConsolidacaoEventoRow } from "@/components/prestacao/consolidacao-table";

import {
  mapConsolidacaoEventoToLinha,
  type PlanilhaLinha,
} from "@spc-up/core/browser";

/** Adapter mínimo: evento da sanfona → linha para PdfComparadorModal. */
export function planilhaLinhaFromEvento(evento: ConsolidacaoEventoRow): PlanilhaLinha {
  return mapConsolidacaoEventoToLinha({
    id: evento.id,
    status: evento.status,
    dataMovimento: evento.dataMovimento,
    valor: evento.valor,
    direcao: evento.direcao,
    confianca: evento.confianca,
    justificativa: evento.justificativa,
    pessoaFisicaId: evento.pessoaFisicaId,
    pessoaJuridicaId: evento.pessoaJuridicaId,
    remetenteDestinatario: evento.remetenteDestinatario,
    pessoa: evento.pessoa,
    linhas: evento.linhas.map((l) => ({
      movimentacaoId: l.movimentacaoId,
      papel: l.papel,
      descricaoRaw: l.descricaoRaw,
      nrExtratoBancario: null,
      nomeArquivo: l.nomeArquivo,
      arquivoIngestaoId: l.arquivoIngestaoId,
      origemExtracao: l.origemExtracao,
    })),
  });
}
