import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";

const listNotebooksMock = vi.fn();
const createNotebookMock = vi.fn();
const getOrCreateNotebookMock = vi.fn();
const syncCandidateFolderMock = vi.fn();
const syncRulesFolderMock = vi.fn();
const uploadFileToNotebookMock = vi.fn();
const queryNotebookMock = vi.fn();
const deleteSourceMock = vi.fn();
const listSourcesMock = vi.fn();
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
  deleteSource: (...args: any[]) => deleteSourceMock(...args),
  listSources: (...args: any[]) => listSourcesMock(...args),
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

import {
  buildNotebookLmExtratoPrompt,
  buildNotebookLmIngestMetadados,
} from "./process-sessao-notebooklm";
import { processSessaoPdfArquivos } from "./process-sessao";

const upsertIngestaoPaginaMock = vi.fn();

vi.mock("../ingest/ingestao-pagina", () => ({
  upsertIngestaoPagina: (...args: unknown[]) => upsertIngestaoPaginaMock(...args),
}));

describe("buildNotebookLmIngestMetadados", () => {
  it("monta metadados NotebookLM preservando chaves existentes", () => {
    const payload = {
      saldo_inicial: 1000,
      saldo_final: 1500,
      total_debitos: 200,
      total_creditos: 700,
      transacoes: [
        {
          data: "2026-01-01",
          valor: 700,
          direcao: "CREDITO" as const,
          descricao: "PIX",
          documento_candidato: null,
          nome_candidato: null,
          fonte_recurso: null,
          natureza_recurso: null,
          tipo_origem_recurso: null,
        },
      ],
    };

    const metadados = buildNotebookLmIngestMetadados(
      { extratoColumnMap: { paginaReferencia: 1 }, origem: "wizard" },
      payload,
      payload.transacoes,
      1,
      ["aviso saldo"],
    );

    expect(metadados.motor).toBe("notebooklm");
    expect(metadados.transacoes_extraidas).toBe(1);
    expect(metadados.movimentacoes_persistidas).toBe(1);
    expect(metadados.linhas_ignoradas_sem_doc).toBe(0);
    expect(metadados.avisos_balance).toEqual(["aviso saldo"]);
    expect(metadados.extratoColumnMap).toEqual({ paginaReferencia: 1 });
    expect(metadados.origem).toBe("wizard");
    expect(metadados.saldos).toEqual({
      saldo_inicial: 1000,
      saldo_final: 1500,
      total_creditos: 700,
      total_debitos: 200,
    });
    expect(typeof metadados.processado_em).toBe("string");
  });
});

describe("buildNotebookLmExtratoPrompt", () => {
  it("scopes extraction to a single filename", () => {
    const prompt = buildNotebookLmExtratoPrompt("Extrato Jan PIX (1).pdf");
    expect(prompt).toContain("Extrato Jan PIX (1).pdf");
    expect(prompt).toContain("apenas");
    expect(prompt).not.toContain("todos os extratos bancários");
  });

  it("appends column map hint when extratoColumnMap is provided", () => {
    const prompt = buildNotebookLmExtratoPrompt("extrato.pdf", {
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0, headerLabel: "Data" },
        { campo: "valor", colunaIndex: 1 },
        { campo: "documento", colunaIndex: 2 },
        { campo: "nome", colunaIndex: 3 },
        { campo: "historico", colunaIndex: 4 },
      ],
    });
    expect(prompt).toContain("---");
    expect(prompt).toContain("coluna 0 = data");
    expect(prompt).toContain("Layout de colunas informado pelo operador");
  });
});

describe("NotebookLM Session Processor", () => {
  beforeEach(() => {
    process.env.USE_NOTEBOOKLM = "true";
    vi.clearAllMocks();
    listSourcesMock.mockResolvedValue([]);
    upsertIngestaoPaginaMock.mockResolvedValue(undefined);
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

    const updateSets: Array<Record<string, unknown>> = [];
    const updateMock = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation((patch) => {
        updateSets.push(patch);
        return { where: vi.fn().mockResolvedValue([{ id: "arq-1" }]) };
      }),
    }));

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
    expect(upsertIngestaoPaginaMock).toHaveBeenCalledWith(
      db,
      "arq-1",
      1,
      expect.objectContaining({
        status: "OK",
        modo: "texto",
        aceitas: 1,
        incertas: 0,
        motivo: "NotebookLM — arquivo inteiro",
      }),
    );
    const concluidoPatch = updateSets.find(
      (patch) => patch.status === "CONCLUIDO" && patch.metadados,
    );
    expect(concluidoPatch?.metadados).toMatchObject({
      motor: "notebooklm",
      transacoes_extraidas: 1,
      movimentacoes_persistidas: 1,
      linhas_ignoradas_sem_doc: 0,
      avisos_balance: [],
    });
    expect(consolidateMock).toHaveBeenCalledWith(db, "sess-nb-1");
    expect(result.movimentacoesTotal).toBe(1);
    expect(result.avisos).toEqual([]);
  });

  it("persists every identical repeated transaction (no hash collapse)", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");

    const tx = {
      data: "2025-01-03",
      valor: 20,
      direcao: "CREDITO" as const,
      descricao: "CRED PIX",
      documento_candidato: null,
      nome_candidato: null,
      fonte_recurso: null,
      natureza_recurso: null,
      tipo_origem_recurso: null,
    };
    queryNotebookMock.mockResolvedValue({
      answer: JSON.stringify({
        saldo_inicial: 0,
        saldo_final: 60,
        total_debitos: 0,
        total_creditos: 60,
        transacoes: [tx, { ...tx }, { ...tx }],
      }),
    });
    consolidateMock.mockResolvedValue({ skipped: true, reason: "NO_MOVIMENTACOES" });

    const discriminadores: unknown[] = [];
    let movSeq = 0;
    const valuesMock = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      discriminadores.push(row.hashMovimento);
      movSeq += 1;
      const id = `mov-${movSeq}`;
      return {
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id }]),
        }),
      };
    });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const pendingRows = [
      { id: "arq-1", nomeArquivo: "extrato.pdf", caminhoStorage: "s3://a", status: "PENDENTE" },
    ];
    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(valuesMock).toHaveBeenCalledTimes(3);
    const uniqueHashes = new Set(discriminadores.map((h) => String(h)));
    expect(uniqueHashes.size).toBe(3);
    expect(result.movimentacoesTotal).toBe(3);
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
    expect(result.avisos[0]).toContain("[extrato_jan.pdf]");
    expect(result.avisos[0]).toContain("Inconsistência de saldos no extrato");
    expect(result.avisos[1]).toContain("Inconsistência de Débitos");
    expect(result.avisos[2]).toContain("Inconsistência de Créditos");
  });

  it("ignores non-PDF pending files in NotebookLM processing", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");
    queryNotebookMock.mockResolvedValue({
      answer: JSON.stringify({
        saldo_inicial: 0,
        saldo_final: 0,
        total_debitos: 0,
        total_creditos: 0,
        transacoes: [],
      }),
    });
    consolidateMock.mockResolvedValue({ skipped: true, reason: "NO_MOVIMENTACOES" });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const pendingRows = [
      { id: "arq-pdf", nomeArquivo: "extrato.pdf", caminhoStorage: "s3://a", status: "PENDENTE" },
      { id: "arq-xlsx", nomeArquivo: "cadastro.xlsx", caminhoStorage: "s3://b", status: "PENDENTE" },
    ];

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(uploadFileToNotebookMock).toHaveBeenCalledTimes(1);
    expect(queryNotebookMock).toHaveBeenCalledTimes(1);
  });

  it("queries NotebookLM once per PDF and attributes movimentacoes to each arquivoIngestaoId", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");

    const payloadA = {
      saldo_inicial: 0,
      saldo_final: 100,
      total_debitos: 0,
      total_creditos: 100,
      transacoes: [
        {
          data: "2026-01-01",
          valor: 100,
          direcao: "CREDITO",
          descricao: "PIX A",
          documento_candidato: null,
          nome_candidato: null,
          fonte_recurso: null,
          natureza_recurso: null,
          tipo_origem_recurso: null,
        },
      ],
    };
    const payloadB = {
      saldo_inicial: 0,
      saldo_final: 50,
      total_debitos: 0,
      total_creditos: 50,
      transacoes: [
        {
          data: "2026-01-02",
          valor: 50,
          direcao: "CREDITO",
          descricao: "PIX B",
          documento_candidato: null,
          nome_candidato: null,
          fonte_recurso: null,
          natureza_recurso: null,
          tipo_origem_recurso: null,
        },
      ],
    };

    queryNotebookMock
      .mockResolvedValueOnce({ answer: JSON.stringify(payloadA) })
      .mockResolvedValueOnce({ answer: JSON.stringify(payloadB) });

    consolidateMock.mockResolvedValue({ skipped: false, eventos: 1 });

    const insertedArquivoIds: string[] = [];
    const valuesMock = vi.fn().mockImplementation((row: { arquivoIngestaoId: string }) => {
      insertedArquivoIds.push(row.arquivoIngestaoId);
      return {
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: `mov-${insertedArquivoIds.length}` }]),
        }),
      };
    });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const pendingRows = [
      { id: "arq-a", nomeArquivo: "extrato_a.pdf", caminhoStorage: "s3://a", status: "PENDENTE" },
      { id: "arq-b", nomeArquivo: "extrato_b.pdf", caminhoStorage: "s3://b", status: "PENDENTE" },
    ];

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(queryNotebookMock).toHaveBeenCalledTimes(2);
    expect(queryNotebookMock.mock.calls[0]![1]).toContain("arq-a_extrato_a.pdf");
    expect(queryNotebookMock.mock.calls[1]![1]).toContain("arq-b_extrato_b.pdf");
    expect(insertedArquivoIds).toEqual(["arq-a", "arq-b"]);
    expect(result.movimentacoesTotal).toBe(2);
    const byArquivo = Object.fromEntries(
      result.arquivos.map((a) => [a.arquivoId, a.movimentacoes_criadas ?? 0]),
    );
    expect(byArquivo["arq-a"]).toBe(1);
    expect(byArquivo["arq-b"]).toBe(1);
  });

  it("uploads and queries each PDF with unique scoped filename when nomeArquivo collides", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");

    const emptyPayload = {
      saldo_inicial: 0,
      saldo_final: 0,
      total_debitos: 0,
      total_creditos: 0,
      transacoes: [],
    };
    queryNotebookMock
      .mockResolvedValueOnce({ answer: JSON.stringify(emptyPayload) })
      .mockResolvedValueOnce({ answer: JSON.stringify(emptyPayload) });
    consolidateMock.mockResolvedValue({ skipped: true, reason: "NO_MOVIMENTACOES" });

    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const pendingRows = [
      { id: "arq-1", nomeArquivo: "extrato.pdf", caminhoStorage: "s3://a", status: "PENDENTE" },
      { id: "arq-2", nomeArquivo: "extrato.pdf", caminhoStorage: "s3://b", status: "PENDENTE" },
    ];

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    await processSessaoPdfArquivos(db, "sess-nb-1");

    expect(uploadFileToNotebookMock).toHaveBeenCalledTimes(2);
    expect(uploadFileToNotebookMock.mock.calls[0]![1]).toMatch(/arq-1_extrato\.pdf$/);
    expect(uploadFileToNotebookMock.mock.calls[1]![1]).toMatch(/arq-2_extrato\.pdf$/);
    expect(queryNotebookMock).toHaveBeenCalledTimes(2);
    expect(queryNotebookMock.mock.calls[0]![1]).toContain("arq-1_extrato.pdf");
    expect(queryNotebookMock.mock.calls[1]![1]).toContain("arq-2_extrato.pdf");
  });

  it("marks second PDF as ERRO when its query fails but keeps first PDF movimentacoes", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");

    queryNotebookMock
      .mockResolvedValueOnce({
        answer: JSON.stringify({
          saldo_inicial: 0,
          saldo_final: 10,
          total_debitos: 0,
          total_creditos: 10,
          transacoes: [
            {
              data: "2026-01-01",
              valor: 10,
              direcao: "CREDITO",
              descricao: "OK",
              documento_candidato: null,
              nome_candidato: null,
              fonte_recurso: null,
              natureza_recurso: null,
              tipo_origem_recurso: null,
            },
          ],
        }),
      })
      .mockRejectedValueOnce(new Error("NLM timeout"));

    consolidateMock.mockResolvedValue({ skipped: false, eventos: 0 });

    const updateSets: Array<{ status?: string; erroMensagem?: string }> = [];
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((patch) => {
        updateSets.push(patch);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    });

    const valuesMock = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "mov-1" }]),
      }),
    });
    const insertMock = vi.fn().mockReturnValue({ values: valuesMock });

    const pendingRows = [
      { id: "arq-a", nomeArquivo: "extrato_a.pdf", caminhoStorage: "s3://a", status: "PENDENTE" },
      { id: "arq-b", nomeArquivo: "extrato_b.pdf", caminhoStorage: "s3://b", status: "PENDENTE" },
    ];

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");

    const arqA = result.arquivos.find((a) => a.arquivoId === "arq-a");
    const arqB = result.arquivos.find((a) => a.arquivoId === "arq-b");

    expect(arqA?.erro).toBeUndefined();
    expect(arqA?.movimentacoes_criadas).toBe(1);
    expect(arqB?.erro).toContain("NLM timeout");
    expect(updateSets.some((s) => s.status === "ERRO" && s.erroMensagem?.includes("NLM timeout"))).toBe(
      true,
    );
  });

  it("passes extratoColumnMaps to queryNotebook prompt and persists metadados", async () => {
    getOrCreateNotebookMock.mockResolvedValue("notebook-123");
    syncCandidateFolderMock.mockResolvedValue(undefined);
    syncRulesFolderMock.mockResolvedValue(undefined);
    readBufferMock.mockResolvedValue(Buffer.from("pdf"));
    uploadFileToNotebookMock.mockResolvedValue("source-1");
    queryNotebookMock.mockResolvedValue({
      answer: JSON.stringify({
        saldo_inicial: 0,
        saldo_final: 0,
        total_debitos: 0,
        total_creditos: 0,
        transacoes: [],
      }),
    });
    consolidateMock.mockResolvedValue({ skipped: true, reason: "NO_MOVIMENTACOES" });

    const extratoColumnMap = {
      paginaReferencia: 1 as const,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0, headerLabel: "Data Mov." },
        { campo: "valor", colunaIndex: 1 },
        { campo: "documento", colunaIndex: 2 },
      ],
    };

    const updateSets: Array<{ metadados?: Record<string, unknown> }> = [];
    const updateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((patch) => {
        if (patch.metadados) {
          updateSets.push(patch);
        }
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    });
    const insertMock = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
      }),
    });

    const pendingRows = [
      {
        id: "arq-1",
        nomeArquivo: "extrato.pdf",
        caminhoStorage: "s3://a",
        status: "PENDENTE",
        metadados: { origem: "wizard" },
      },
    ];

    const selectMock = vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table) => {
        if (table === pessoaFisica || table === pessoaJuridica) {
          return Promise.resolve([]);
        }
        return { where: vi.fn().mockResolvedValue(pendingRows) };
      }),
    });

    const db = { select: selectMock, update: updateMock, insert: insertMock } as any;

    await processSessaoPdfArquivos(db, "sess-nb-1", {
      extratoColumnMaps: { "arq-1": extratoColumnMap },
    });

    const prompt = queryNotebookMock.mock.calls[0]![1] as string;
    expect(prompt).toContain("coluna 0 = data");
    expect(prompt).toContain("Data Mov.");
    const columnMapPatch = updateSets.find(
      (s) => s.metadados?.extratoColumnMap && !s.metadados?.motor,
    );
    expect(columnMapPatch?.metadados).toMatchObject({
      origem: "wizard",
      extratoColumnMap,
    });
    const finalPatch = updateSets.find((s) => s.metadados?.motor === "notebooklm");
    expect(finalPatch?.metadados).toMatchObject({
      origem: "wizard",
      extratoColumnMap,
      motor: "notebooklm",
      transacoes_extraidas: 0,
    });
    expect(upsertIngestaoPaginaMock).toHaveBeenCalledWith(
      db,
      "arq-1",
      1,
      expect.objectContaining({
        motivo: "Nenhuma transação extraída",
      }),
    );
  });

  it("should NOT link candidate when documento_candidato is invalid or missing", async () => {
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
      pessoaFisicaId: null,
    }));
    expect(result.movimentacoesTotal).toBe(1);
  });
});
