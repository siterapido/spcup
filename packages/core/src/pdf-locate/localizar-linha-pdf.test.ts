import { describe, expect, it } from "vitest";

import type { PdfPaginaTexto, PdfTextItem } from "./types";
import {
  agruparItensEmLinhas,
  localizarLinhaPdf,
} from "./localizar-linha-pdf";

function item(
  str: string,
  x: number,
  y: number,
  width = 0.1,
  height = 0.02,
): PdfTextItem {
  return { str, x, y, width, height };
}

function pagina(paginaNum: number, itens: PdfTextItem[]): PdfPaginaTexto {
  return { pagina: paginaNum, itens };
}

describe("agruparItensEmLinhas", () => {
  it("clusters items on same y and unions bbox", () => {
    const linhas = agruparItensEmLinhas([
      item("15/01/2025", 0.1, 0.5),
      item("1.500,00", 0.3, 0.5),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.texto).toContain("15/01/2025");
    expect(linhas[0]!.texto).toContain("1.500,00");
    expect(linhas[0]!.bbox.x).toBeCloseTo(0.1);
    expect(linhas[0]!.bbox.y).toBeCloseTo(0.5);
    expect(linhas[0]!.bbox.w).toBeCloseTo(0.3);
    expect(linhas[0]!.bbox.h).toBeCloseTo(0.02);
  });

  it("separates items on different y beyond tolerance", () => {
    const linhas = agruparItensEmLinhas([
      item("15/01/2025", 0.1, 0.2),
      item("1.500,00", 0.1, 0.5),
    ]);

    expect(linhas).toHaveLength(2);
  });
});

describe("localizarLinhaPdf", () => {
  it("matches valor and data on the same line", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("Saldo anterior", 0.1, 0.1),
          item("15/01/2025", 0.1, 0.5),
          item("PIX recebido", 0.2, 0.5),
          item("1.500,00", 0.5, 0.5),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "PIX recebido",
    });

    expect(result).toMatchObject({
      encontrado: true,
      pagina: 1,
      confianca: "estimada",
    });
    if (result.encontrado) {
      expect(result.bbox.x).toBeCloseTo(0.1);
      expect(result.bbox.y).toBeCloseTo(0.5);
      expect(result.bbox.w).toBeCloseTo(0.5);
      expect(result.bbox.h).toBeCloseTo(0.02);
    }
  });

  it("returns false when valor and data are on different lines", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("15/01/2025", 0.1, 0.2),
          item("1.500,00", 0.1, 0.6),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "PIX",
    });

    expect(result).toEqual({
      encontrado: false,
      motivo: "Nenhuma linha com valor e data na mesma linha",
    });
  });

  it("tiebreaks by descricaoRaw token overlap when multiple lines share valor", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("15/01/2025", 0.1, 0.3),
          item("1.500,00", 0.4, 0.3),
          item("Doacao Maria Silva", 0.1, 0.3, 0.2),
          item("15/01/2025", 0.1, 0.6),
          item("1.500,00", 0.4, 0.6),
          item("Pagamento aluguel", 0.1, 0.6, 0.2),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "Doacao Maria Silva",
    });

    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.pagina).toBe(1);
      expect(result.bbox.y).toBeCloseTo(0.3, 2);
    }
  });

  it("matches BR valor formats and DD/MM/YYYY date", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("R$ 1.500,00", 0.1, 0.4),
          item("em 15/01/2025", 0.3, 0.4),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "transferencia",
    });

    expect(result.encontrado).toBe(true);
  });

  it("matches dot-decimal valor without thousands separator", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [item("15/01/25 1500.00 debito", 0.1, 0.4, 0.5)]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "debito",
    });

    expect(result.encontrado).toBe(true);
  });

  it("matches on page 2 when page 1 has no match", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [item("Saldo 100,00", 0.1, 0.1)]),
        pagina(2, [
          item("15/01/2025", 0.1, 0.5),
          item("R$ 1500.00", 0.4, 0.5),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "PIX",
    });

    expect(result).toMatchObject({
      encontrado: true,
      pagina: 2,
      confianca: "estimada",
    });
  });

  it("prefere remetente quando várias linhas têm o mesmo valor (PIX Caixa)", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("EFETIVADO ERICK SUZART SOUZA R$ 100,00", 0.1, 0.5, 0.8),
          item("EFETIVADO NADSON SILVA DOS SANTOS R$ 100,00", 0.1, 0.6, 0.8),
        ]),
      ],
      dataMovimento: "2025-01-03",
      valor: "100.00",
      descricaoRaw: "PIX RECEBIDO",
      remetenteDestinatario: "NADSON SILVA DOS SANTOS",
      relaxarDataNaLinha: true,
    });

    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.bbox.y).toBeCloseTo(0.6, 2);
    }
  });

  it("localiza completo por documento DDHHMM na linha", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("02/01/2025 000000 SALDO DO DIA", 0.1, 0.4, 0.7),
          item("03/01/2025 031240 CRED PIX", 0.1, 0.5, 0.7),
        ]),
      ],
      dataMovimento: "2025-01-03",
      valor: "100.00",
      descricaoRaw: "CRED PIX",
      documento: "031240",
    });

    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.bbox.y).toBeCloseTo(0.5, 2);
    }
  });

  it("strips CPF/CNPJ from descricaoRaw for tiebreaker", () => {
    const result = localizarLinhaPdf({
      paginas: [
        pagina(1, [
          item("15/01/2025 1.500,00 Doacao Joao", 0.1, 0.3, 0.6),
          item("15/01/2025 1.500,00 Outro pagamento", 0.1, 0.6, 0.6),
        ]),
      ],
      dataMovimento: "2025-01-15",
      valor: "1500.00",
      descricaoRaw: "Doacao Joao CPF 123.456.789-09",
    });

    expect(result.encontrado).toBe(true);
    if (result.encontrado) {
      expect(result.bbox.y).toBeCloseTo(0.3, 2);
    }
  });
});
