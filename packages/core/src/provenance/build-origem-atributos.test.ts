import { describe, expect, it } from "vitest";

import type { ConsolidacaoEventDraft, MovimentacaoCandidate } from "../consolidacao/types";
import { buildOrigemAtributos } from "./build-origem-atributos";

function mov(partial: Partial<MovimentacaoCandidate> & Pick<MovimentacaoCandidate, "id">): MovimentacaoCandidate {
  return {
    arquivoIngestaoId: "a1",
    nomeArquivo: "pix.pdf",
    dataMovimento: "2025-01-10",
    valor: "100.00",
    direcao: "SAIDA",
    descricaoRaw: "PIX João",
    cpfExtraido: null,
    cnpjExtraido: null,
    origemExtracao: {
      versao: 1,
      arquivoIngestaoId: "a1",
      nomeArquivo: "pix.pdf",
      pagina: 1,
      indiceLinha: 2,
    },
    ...partial,
  };
}

describe("buildOrigemAtributos", () => {
  it("pair event includes PDF and cruzamento refs", () => {
    const pix = mov({ id: "m1", nomeArquivo: "pix.pdf" });
    const completo = mov({
      id: "m2",
      nomeArquivo: "total.pdf",
      origemExtracao: {
        versao: 1,
        arquivoIngestaoId: "a2",
        nomeArquivo: "total.pdf",
        pagina: 2,
        indiceLinha: 5,
        bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.04 },
      },
    });
    const movById = new Map([
      [pix.id, pix],
      [completo.id, completo],
    ]);
    const draft: Omit<ConsolidacaoEventDraft, "origemAtributos"> = {
      dataMovimento: pix.dataMovimento,
      valor: pix.valor,
      direcao: pix.direcao,
      confianca: 0.9,
      justificativa: "CPF no extrato completo e nome alinhado ao cadastro",
      pessoaFisicaId: "pf-1",
      linhas: [
        {
          movimentacaoId: pix.id,
          arquivoIngestaoId: pix.arquivoIngestaoId,
          papel: "PIX",
          descricaoRaw: pix.descricaoRaw,
        },
        {
          movimentacaoId: completo.id,
          arquivoIngestaoId: completo.arquivoIngestaoId,
          papel: "COMPLETO",
          descricaoRaw: completo.descricaoRaw,
        },
      ],
      hipoteses: [],
      evidencias: [],
    };
    const origem = buildOrigemAtributos(draft, movById);
    expect(origem.dataMovimento).toHaveLength(2);
    expect(origem.pessoa.some((r) => r.tipo === "CRUZAMENTO_PDF")).toBe(true);
    expect(origem.pessoa.some((r) => r.tipo === "CADASTRO_UF")).toBe(true);
    expect(origem.valor[0]?.tipo).toBe("PDF");
  });
});
