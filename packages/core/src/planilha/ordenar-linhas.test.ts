import { describe, expect, it } from "vitest";

import { mapMovimentacaoToLinha } from "./list";
import { ordenarLinhasPlanilha } from "./ordenar-linhas";

function mov(
  id: string,
  dataMovimento: string,
  valor: string,
  confiancaGlobal: number,
) {
  return mapMovimentacaoToLinha({
    id,
    dataMovimento,
    valor,
    direcao: "ENTRADA",
    descricaoRaw: "CRED PIX",
    confiancaGlobal,
    pessoaFisica: null,
    pessoaJuridica: null,
    nomeArquivo: "extrato.pdf",
    origemExtracao: null,
  });
}

describe("ordenarLinhasPlanilha", () => {
  it("cronologico_desc inverte data", () => {
    const linhas = ordenarLinhasPlanilha(
      [mov("a", "2025-01-03", "10", 0.5), mov("b", "2025-01-15", "10", 0.5)],
      "cronologico_desc",
    );
    expect(linhas.map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("confianca_desc prioriza maior confiança", () => {
    const linhas = ordenarLinhasPlanilha(
      [mov("baixa", "2025-01-01", "10", 0.4), mov("alta", "2025-01-20", "10", 0.95)],
      "confianca_desc",
    );
    expect(linhas.map((l) => l.id)).toEqual(["alta", "baixa"]);
  });

  it("valor_asc ordena por valor numérico", () => {
    const linhas = ordenarLinhasPlanilha(
      [mov("grande", "2025-01-01", "100.00", 0.5), mov("pequeno", "2025-01-01", "20.00", 0.5)],
      "valor_asc",
    );
    expect(linhas.map((l) => l.id)).toEqual(["pequeno", "grande"]);
  });
});
