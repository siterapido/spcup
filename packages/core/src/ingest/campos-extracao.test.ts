import { describe, expect, it } from "vitest";
import {
  buildCamposExtracaoFromNotebookTx,
  mergeCamposExtracao,
  espelharCamposLegados,
} from "./campos-extracao";

describe("buildCamposExtracaoFromNotebookTx", () => {
  it("mapeia PIX com todos os campos", () => {
    const campos = buildCamposExtracaoFromNotebookTx({
      data: "2025-01-05",
      valor: 150,
      direcao: "CREDITO",
      descricao: "RECEBIDO",
      hora: "14:32",
      tipo_pix: "Recebido",
      situacao: "Efetivado",
      remetente_destinatario: "MARIA SILVA",
      documento: null,
      historico: null,
    });
    expect(campos.remetente_destinatario).toBe("MARIA SILVA");
    expect(campos.hora).toBe("14:32");
  });

  it("mapeia Total com historico e documento", () => {
    const campos = buildCamposExtracaoFromNotebookTx({
      data: "2025-01-05",
      valor: 150,
      direcao: "CREDITO",
      descricao: "PIX RECEBIDO - MARIA SILVA",
      historico: "PIX RECEBIDO - MARIA SILVA",
      documento: "123456",
      saldo: "12500.00",
      remetente_destinatario: null,
    });
    expect(campos.historico).toContain("MARIA");
    expect(campos.documento).toBe("123456");
    expect(campos.remetente_destinatario).toBeUndefined();
  });
});

describe("mergeCamposExtracao", () => {
  it("une chaves de PIX e Total sem sobrescrever", () => {
    const merged = mergeCamposExtracao(
      { remetente_destinatario: "MARIA", hora: "14:00" },
      { historico: "PIX - MARIA", documento: "99" },
    );
    expect(merged.remetente_destinatario).toBe("MARIA");
    expect(merged.historico).toBe("PIX - MARIA");
    expect(merged.documento).toBe("99");
  });
});

describe("espelharCamposLegados", () => {
  it("espelha documento em nrExtratoBancario", () => {
    expect(espelharCamposLegados({ documento: "123" }).nrExtratoBancario).toBe("123");
  });
});
