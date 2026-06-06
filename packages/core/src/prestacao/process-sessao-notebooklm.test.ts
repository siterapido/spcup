import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";

const listNotebooksMock = vi.fn();
const createNotebookMock = vi.fn();
const getOrCreateNotebookMock = vi.fn();
const syncCandidateFolderMock = vi.fn();
const syncRulesFolderMock = vi.fn();
const uploadFileToNotebookMock = vi.fn();
const queryNotebookMock = vi.fn();
const consolidateMock = vi.fn();
const readBufferMock = vi.fn();
const upsertPessoaMock = vi.fn();

vi.mock("../ai/notebooklm", () => ({
  listNotebooks: (...args: any[]) => listNotebooksMock(...args),
  createNotebook: (...args: any[]) => createNotebookMock(...args),
  getOrCreateNotebook: (...args: any[]) => getOrCreateNotebookMock(...args),
  syncCandidateFolder: (...args: any[]) => syncCandidateFolderMock(...args),
  syncRulesFolder: (...args: any[]) => syncRulesFolderMock(...args),
  uploadFileToNotebook: (...args: any[]) => uploadFileToNotebookMock(...args),
  queryNotebook: (...args: any[]) => queryNotebookMock(...args),
}));

vi.mock("../consolidacao/run", () => ({
  consolidateSession: (...args: any[]) => consolidateMock(...args),
}));

vi.mock("../storage/read-arquivo", () => ({
  readArquivoIngestaoBuffer: (...args: any[]) => readBufferMock(...args),
}));

vi.mock("../cadastro/upsert", () => ({
  upsertPessoa: (...args: any[]) => upsertPessoaMock(...args),
}));

vi.mock("./sessao", () => ({
  getSessao: vi.fn(async () => ({
    id: "sess-nb-1",
    uf: "BA",
    exercicio: 2026,
    consolidarExtratos: true,
    diretorioEstadual: { cnpjPrestador: "23738595000182" },
    diretorioMunicipal: null,
    tipoPrestador: "ESTADUAL",
  })),
  prestadorFromSessao: vi.fn(() => ({
    cnpjPrestador: "23738595000182",
    tipoPrestador: "ESTADUAL",
    sessaoPrestacaoId: "sess-nb-1",
    diretorioMunicipalId: null,
  })),
}));

import { processSessaoPdfArquivos } from "./process-sessao";

describe("NotebookLM Session Processor", () => {
  beforeEach(() => {
    process.env.USE_NOTEBOOKLM = "true";
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.USE_NOTEBOOKLM;
  });

  it("should default to NotebookLM processing when USE_NOTEBOOKLM is undefined", async () => {
    delete process.env.USE_NOTEBOOKLM; // Garante que está indefinido
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("mock statement pdf content"));
    uploadFileToNotebookMock.mockResolvedValue("source-456");
    
    const mockAnswer = JSON.stringify({
      sucesso: true,
      data: {
        movimentacoesTotal: 1,
        paginasVerificar: 0,
        arquivos: [
          {
            arquivoId: "arq-1",
            nome: "extrato.pdf",
            paginas: []
          }
        ],
        consolidacao: { skipped: true, reason: "MOCK" }
      }
    });
    queryNotebookMock.mockResolvedValue({ answer: mockAnswer, text: mockAnswer });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "arq-1" }]),
      }),
    });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        if (table === pessoaJuridica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        return {
          where: vi.fn().mockResolvedValue([
            {
              id: "arq-1",
              nomeArquivo: "extrato_jan.pdf",
              caminhoStorage: "https://blob.vercel-storage.com/extrato.pdf",
              status: "PENDENTE",
            },
          ]),
        };
      }),
    });

    const db = {
      select: selectMock,
      update: updateMock,
    } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");
    expect(result.sessaoId).toBe("sess-nb-1");
    expect(getOrCreateNotebookMock).toHaveBeenCalled();
  });

  it("should process session with NotebookLM when USE_NOTEBOOKLM is true and validate SPCA fields and saldos", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("mock statement pdf content"));
    uploadFileToNotebookMock.mockResolvedValue("source-456");
    
    const mockAnswer = JSON.stringify({
      saldo_inicial: 1000.00,
      saldo_final: 2500.00,
      total_debitos: 0.00,
      total_creditos: 1500.00,
      transacoes: [
        {
          data: "2026-01-10",
          valor: 1500.00,
          direcao: "CREDITO",
          descricao: "DEPOSITO IDENTIFICADO MARIA",
          documento_candidato: "12345678901",
          nome_candidato: "MARIA CANDIDATA",
          fonte_recurso: "OR",
          natureza_recurso: "0",
          tipo_origem_recurso: "PF"
        }
      ]
    });
    queryNotebookMock.mockResolvedValue({ answer: mockAnswer });
    upsertPessoaMock.mockResolvedValue({ action: "inserted", pessoaFisicaId: "pf-maria-id" });
    consolidateMock.mockResolvedValue({ skipped: false, eventos: 1 });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "arq-1" }]),
      }),
    });

    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue([{ id: "mov-1" }]),
      }),
    });

    const insertMock = vi.fn().mockReturnValue({
      values: valuesMock,
    });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        if (table === pessoaJuridica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        return {
          where: vi.fn().mockResolvedValue([
            {
              id: "arq-1",
              nomeArquivo: "extrato_jan.pdf",
              caminhoStorage: "https://blob.vercel-storage.com/extrato.pdf",
              status: "PENDENTE",
            },
          ]),
        };
      }),
    });

    const db = {
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(getOrCreateNotebookMock).toHaveBeenCalledWith("BA", 2026);
    expect(syncCandidateFolderMock).toHaveBeenCalledWith("notebook-123", "BA", 2026);
    expect(syncRulesFolderMock).toHaveBeenCalledWith("notebook-123");
    expect(uploadFileToNotebookMock).toHaveBeenCalled();
    expect(queryNotebookMock).toHaveBeenCalled();
    expect(upsertPessoaMock).toHaveBeenCalledWith(
      db,
      { tipo: "PF", documento: "12345678901", nome: "MARIA CANDIDATA" },
      { uf: "BA", exercicio: 2026, origem: "IMPORT" }
    );
    expect(insertMock).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      pessoaFisicaId: "pf-maria-id",
    }));
    expect(consolidateMock).toHaveBeenCalledWith(db, "sess-nb-1");
    expect(result.movimentacoesTotal).toBe(1);
    expect(result.avisos).toEqual([]);
  });

  it("should generate mathematical warnings when saldos or transacao sums do not match", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("mock statement pdf content"));
    uploadFileToNotebookMock.mockResolvedValue("source-456");
    
    const mockAnswer = JSON.stringify({
      saldo_inicial: 1000.00,
      saldo_final: 2500.00,
      total_debitos: 100.00,
      total_creditos: 1500.00,
      transacoes: [
        {
          data: "2026-01-10",
          valor: 1400.00,
          direcao: "CREDITO",
          descricao: "DEPOSITO IDENTIFICADO MARIA",
          documento_candidato: "12345678901",
          nome_candidato: "MARIA CANDIDATA",
          fonte_recurso: "OR",
          natureza_recurso: "0",
          tipo_origem_recurso: "PF"
        },
        {
          data: "2026-01-11",
          valor: 150.00,
          direcao: "DEBITO",
          descricao: "TARIFA BANCARIA",
          documento_candidato: null,
          nome_candidato: null,
          fonte_recurso: null,
          natureza_recurso: null,
          tipo_origem_recurso: null
        }
      ]
    });
    queryNotebookMock.mockResolvedValue({ answer: mockAnswer });
    upsertPessoaMock.mockResolvedValue({ action: "inserted", pessoaFisicaId: "pf-maria-id" });
    consolidateMock.mockResolvedValue({ skipped: false, eventos: 1 });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "arq-1" }]),
      }),
    });

    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue([{ id: "mov-1" }]),
      }),
    });

    const insertMock = vi.fn().mockReturnValue({
      values: valuesMock,
    });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        if (table === pessoaJuridica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        return {
          where: vi.fn().mockResolvedValue([
            {
              id: "arq-1",
              nomeArquivo: "extrato_jan.pdf",
              caminhoStorage: "https://blob.vercel-storage.com/extrato.pdf",
              status: "PENDENTE",
            },
          ]),
        };
      }),
    });

    const db = {
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(result.avisos.length).toBe(3);
    expect(result.avisos[0]).toContain("Inconsistência de saldos no extrato");
    expect(result.avisos[1]).toContain("Inconsistência de Débitos");
    expect(result.avisos[2]).toContain("Inconsistência de Créditos");
  });

  it("should fallback to name-based fuzzy match when documento_candidato is invalid or missing", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("mock statement pdf content"));
    uploadFileToNotebookMock.mockResolvedValue("source-456");
    
    const mockAnswer = JSON.stringify({
      saldo_inicial: 1000.00,
      saldo_final: 2500.00,
      total_debitos: 0.00,
      total_creditos: 1500.00,
      transacoes: [
        {
          data: "2026-01-10",
          valor: 1500.00,
          direcao: "CREDITO",
          descricao: "DEPOSITO IDENTIFICADO MARIA",
          documento_candidato: "123",
          nome_candidato: "MARIA CANDIDAT",
          fonte_recurso: "OR",
          natureza_recurso: "0",
          tipo_origem_recurso: "PF"
        }
      ]
    });
    queryNotebookMock.mockResolvedValue({ answer: mockAnswer });
    consolidateMock.mockResolvedValue({ skipped: false, eventos: 1 });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "arq-1" }]),
      }),
    });

    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue([{ id: "mov-1" }]),
      }),
    });

    const insertMock = vi.fn().mockReturnValue({
      values: valuesMock,
    });

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica) {
          return {
            then: (resolve: any) => resolve([{ id: "pf-maria-id", cpf: "12345678901", nome: "MARIA CANDIDATA" }]),
            catch: () => {}
          };
        }
        if (table === pessoaJuridica) {
          return {
            then: (resolve: any) => resolve([]),
            catch: () => {}
          };
        }
        return {
          where: vi.fn().mockResolvedValue([
            {
              id: "arq-1",
              nomeArquivo: "extrato_jan.pdf",
              caminhoStorage: "https://blob.vercel-storage.com/extrato.pdf",
              status: "PENDENTE",
            },
          ]),
        };
      }),
    });

    const db = {
      select: selectMock,
      update: updateMock,
      insert: insertMock,
    } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(upsertPessoaMock).not.toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalled();
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      pessoaFisicaId: "pf-maria-id",
    }));
    expect(result.movimentacoesTotal).toBe(1);
  });
});
