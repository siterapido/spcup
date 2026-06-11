import { describe, expect, it } from "vitest";

import { mapMovimentacaoToLinha } from "./list";
import {
  compareLinhasPlanilhaCronologicamente,
  ordenarLinhasPlanilhaCronologicamente,
} from "./ordenar-linhas-cronologico";

function movLinha(
  id: string,
  dataMovimento: string,
  extras: {
    hora?: string;
    documento?: string;
    indiceLinha?: number;
  } = {},
) {
  return mapMovimentacaoToLinha({
    id,
    dataMovimento,
    valor: "10.00",
    direcao: "ENTRADA",
    descricaoRaw: "CRED PIX",
    confiancaGlobal: 0.85,
    pessoaFisica: null,
    pessoaJuridica: null,
    nomeArquivo: "extrato.pdf",
    origemExtracao: extras.indiceLinha
      ? {
          versao: 1,
          arquivoIngestaoId: "a1",
          nomeArquivo: "extrato.pdf",
          pagina: 1,
          indiceLinha: extras.indiceLinha,
        }
      : null,
    camposExtracao: {
      ...(extras.hora ? { hora: extras.hora } : {}),
      ...(extras.documento ? { documento: extras.documento } : {}),
    },
  });
}

describe("ordenarLinhasPlanilhaCronologicamente", () => {
  it("ordena por data asc", () => {
    const linhas = ordenarLinhasPlanilhaCronologicamente([
      movLinha("b", "2025-01-15"),
      movLinha("a", "2025-01-03"),
    ]);
    expect(linhas.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("no mesmo dia ordena por hora asc", () => {
    const linhas = ordenarLinhasPlanilhaCronologicamente([
      movLinha("tarde", "2025-01-13", { hora: "23:17:34" }),
      movLinha("manha", "2025-01-13", { hora: "17:26:50" }),
    ]);
    expect(linhas.map((l) => l.id)).toEqual(["manha", "tarde"]);
  });

  it("ignora ordem de confiança alta vinda do backend", () => {
    const alta = mapMovimentacaoToLinha({
      id: "alta",
      dataMovimento: "2025-01-20",
      valor: "100.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX",
      confiancaGlobal: 0.99,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    const baixa = mapMovimentacaoToLinha({
      id: "baixa",
      dataMovimento: "2025-01-03",
      valor: "20.00",
      direcao: "ENTRADA",
      descricaoRaw: "CRED PIX",
      confiancaGlobal: 0.4,
      pessoaFisica: null,
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
    });
    const linhas = ordenarLinhasPlanilhaCronologicamente([alta, baixa]);
    expect(linhas.map((l) => l.id)).toEqual(["baixa", "alta"]);
  });

  it("compare é estável com documento e id", () => {
    const a = movLinha("z", "2025-01-01", { documento: "200" });
    const b = movLinha("y", "2025-01-01", { documento: "100" });
    expect(compareLinhasPlanilhaCronologicamente(a, b)).toBeGreaterThan(0);
  });
});
