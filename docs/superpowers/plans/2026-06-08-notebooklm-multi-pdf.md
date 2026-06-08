# NotebookLM Multi-PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o processamento NotebookLM para que cada PDF da sessão receba sua própria query e suas movimentações sejam persistidas com o `arquivoIngestaoId` correto, habilitando consolidação entre extratos.

**Architecture:** Manter upload compartilhado no notebook (cadastro + regras + todos os PDFs). Substituir a query global única por um loop `for (arq of processedSucessfully)` que chama `queryNotebook` com prompt escopado ao `nomeArquivo`, parseia o JSON e persiste via função interna `persistNotebookLmTransactions`. Filtrar pendentes para `.pdf` apenas.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM (`@spc-up/db`), NotebookLM CLI wrapper (`packages/core/src/ai/notebooklm.ts`).

**Spec:** `docs/superpowers/specs/2026-06-08-notebooklm-multi-pdf-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/prestacao/process-sessao-notebooklm.ts` | Prompt builder, persist helper, loop query-per-PDF |
| `packages/core/src/prestacao/process-sessao-notebooklm.test.ts` | Testes multi-PDF, regressão, filtro `.pdf` |

Nenhum arquivo novo. Nenhuma mudança em web/CLI neste plano.

---

### Task 1: `buildNotebookLmExtratoPrompt` + teste unitário

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts`
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Write the failing test**

Adicionar no final de `process-sessao-notebooklm.test.ts` (antes do último `});` do describe, ou em novo `describe("buildNotebookLmExtratoPrompt")`):

```ts
import { buildNotebookLmExtratoPrompt } from "./process-sessao-notebooklm";

describe("buildNotebookLmExtratoPrompt", () => {
  it("scopes extraction to a single filename", () => {
    const prompt = buildNotebookLmExtratoPrompt("Extrato Jan PIX (1).pdf");
    expect(prompt).toContain("Extrato Jan PIX (1).pdf");
    expect(prompt).toContain("apenas");
    expect(prompt).not.toContain("todos os extratos bancários");
  });
});
```

Exportar a função no módulo de produção (ver Step 3).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "scopes extraction"
```

Expected: FAIL — `buildNotebookLmExtratoPrompt` is not exported / not defined.

- [ ] **Step 3: Implement prompt builder**

Em `process-sessao-notebooklm.ts`, renomear `NOTEBOOKLM_QUERY_PROMPT` para `NOTEBOOKLM_QUERY_PROMPT_BASE` (const interna) e adicionar:

```ts
export function buildNotebookLmExtratoPrompt(nomeArquivo: string): string {
  return `Você concilia transações bancárias de prestação de contas partidária no Brasil.
Analise APENAS o extrato bancário cujo nome de arquivo no notebook é exatamente: "${nomeArquivo}".
Não inclua transações de outros extratos presentes neste notebook.
Use os arquivos de cadastro (PF/PJ) e documentos de regras formais do SPCA/TSE contidos neste notebook para cruzar candidatos e classificar recursos.
Extraia todas as transações (lançamentos) de débito e crédito presentes SOMENTE nesse extrato.
Para cada transação extraída, cruze com as informações dos arquivos de cadastro de candidatos fornecidos para encontrar o candidato correspondente (seja por nome, CPF/CNPJ ou dados correlacionados).
Determine também a Fonte de Recurso, a Natureza de Recurso e o Tipo Origem do Recurso para a transação, utilizando os documentos de regras do SPCA e a tabela de códigos abaixo para maior precisão jurídica.

Tabela de Códigos SPCA para Referência:

1. Fonte de Recurso (fonte_recurso):
- FP: Fundo Partidário
- OR: Outros Recursos
- RC: Recurso de Campanha
- FEFC: Fundo Especial de Financiamento de Campanha

2. Natureza de Recurso (natureza_recurso):
- 0: Financeiro
- 1: Estimável em dinheiro

3. Tipo Origem do Recurso (tipo_origem_recurso):
- CE: Candidato/Comitê - Recursos Próprios
- CF: Candidato - Doação de Outros Candidatos / Comitês
- PF: Pessoa Física
- PJ: Pessoa Jurídica
- PP: Partido Político
- CA: Comercialização
- NI: Não Identificado

Extraia também os metadados de saldos do extrato bancário.
Retorne APENAS um objeto JSON válido (sem explicações ou marcações markdown como \`\`\`json). O objeto deve ter o seguinte formato exato:
{
  "saldo_inicial": 1000.00,
  "saldo_final": 1500.00,
  "total_debitos": 500.00,
  "total_creditos": 1000.00,
  "transacoes": [
    {
      "data": "YYYY-MM-DD",
      "valor": 1250.50,
      "direcao": "CREDITO" | "DEBITO",
      "descricao": "Descrição original da transação",
      "documento_candidato": "CPF ou CNPJ do candidato correspondente (somente números, ou null)",
      "nome_candidato": "Nome ou Razão Social do candidato correspondente (ou null)",
      "fonte_recurso": "Código da fonte de recurso (ex: 'FP', 'OR', 'RC', 'FEFC' ou null)",
      "natureza_recurso": "Código da natureza de recurso (ex: '0', '1' ou null)",
      "tipo_origem_recurso": "Código do tipo de origem do recurso (ex: 'CE', 'CF', 'PF', 'PJ', 'PP', 'CA', 'NI' ou null)"
    }
  ]
}`;
}
```

Remover a const antiga `NOTEBOOKLM_QUERY_PROMPT` (substituída pela função).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "scopes extraction"
```

Expected: PASS

---

### Task 2: Filtro `.pdf` nos arquivos pendentes

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts:227-238`
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Write the failing test**

Adicionar teste de integração mockada:

```ts
it("ignores non-PDF pending files in NotebookLM processing", async () => {
  process.env.USE_NOTEBOOKLM = "true";
  getOrCreateNotebookMock.mockResolvedValue("notebook-123");
  syncCandidateFolderMock.mockResolvedValue(undefined);
  syncRulesFolderMock.mockResolvedValue(undefined);
  readBufferMock.mockResolvedValue(Buffer.from("pdf"));
  uploadFileToNotebookMock.mockResolvedValue("source-1");
  queryNotebookMock.mockResolvedValue({
    answer: JSON.stringify({ saldo_inicial: 0, saldo_final: 0, total_debitos: 0, total_creditos: 0, transacoes: [] }),
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "ignores non-PDF"
```

Expected: FAIL — `uploadFileToNotebookMock` called 2 times (xlsx também sobe).

- [ ] **Step 3: Add PDF filter after DB select**

Substituir uso direto de `pendingFiles` por:

```ts
  const pendingRows = await db
    .select()
    .from(arquivoIngestao)
    .where(
      and(
        eq(arquivoIngestao.sessaoPrestacaoId, sessaoId),
        inArray(arquivoIngestao.status, [
          ARQUIVO_INGESTAO_STATUS.PENDENTE,
          ARQUIVO_INGESTAO_STATUS.PROCESSANDO,
        ]),
      ),
    );

  const pendingFiles = pendingRows.filter((r) => /\.pdf$/i.test(r.nomeArquivo));
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "ignores non-PDF"
```

Expected: PASS

---

### Task 3: Extrair `persistNotebookLmTransactions`

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts`

- [ ] **Step 1: Extract persist logic into internal function**

Adicionar antes de `processSessaoWithNotebookLM`:

```ts
type PersistNotebookLmContext = {
  uf: string;
  exercicio: number;
  sessaoId: string;
  arquivoIngestaoId: string;
  prestadorBase: ReturnType<typeof prestadorFromSessao>;
  allPFs: NameCandidate[];
  allPJs: NameCandidate[];
};

async function persistNotebookLmTransactions(
  db: Db,
  ctx: PersistNotebookLmContext,
  transactions: NotebookLmTx[],
): Promise<number> {
  let created = 0;
  const { uf, exercicio, sessaoId, arquivoIngestaoId, prestadorBase, allPFs, allPJs } = ctx;

  for (const tx of transactions) {
    let pfId: string | null = null;
    let pjId: string | null = null;

    const { hasValidDoc, cleanedDoc } = parseCandidateDocument(tx.documento_candidato);

    if (hasValidDoc && tx.nome_candidato) {
      const isPf = cleanedDoc.length === 11;
      const upsertRes = await upsertPessoa(
        db,
        {
          tipo: isPf ? "PF" : "PJ",
          documento: cleanedDoc,
          nome: tx.nome_candidato,
        },
        { uf, exercicio, origem: "IMPORT" },
      );

      if (isPf) {
        pfId = upsertRes.pessoaFisicaId || null;
      } else {
        pjId = upsertRes.pessoaJuridicaId || null;
      }
    } else if (tx.nome_candidato) {
      const searchName = normalizeName(tx.nome_candidato);
      const bestPf = findBestNameMatch(searchName, allPFs);
      const bestPj = findBestNameMatch(searchName, allPJs);

      if (bestPf && bestPj) {
        if (bestPf.similarity >= bestPj.similarity) {
          pfId = bestPf.id;
        } else {
          pjId = bestPj.id;
        }
      } else if (bestPf) {
        pfId = bestPf.id;
      } else if (bestPj) {
        pjId = bestPj.id;
      }
    }

    const hashInput = {
      dataMovimento: new Date(tx.data),
      valor: tx.valor.toFixed(2),
      descricaoRaw: tx.descricao,
      direcao: tx.direcao === "CREDITO" ? "ENTRADA" : "SAIDA",
    };

    const hash = computeHashMovimento(prestadorBase.cnpjPrestador, exercicio, hashInput);

    const [mov] = await db
      .insert(movimentacao)
      .values({
        uf,
        exercicio,
        dataMovimento: tx.data,
        valor: tx.valor.toFixed(2),
        descricaoRaw: tx.descricao,
        direcao: tx.direcao === "CREDITO" ? "ENTRADA" : "SAIDA",
        pessoaFisicaId: pfId,
        pessoaJuridicaId: pjId,
        arquivoIngestaoId,
        sessaoPrestacaoId: sessaoId,
        cnpjPrestador: prestadorBase.cnpjPrestador,
        tipoPrestador: prestadorBase.tipoPrestador,
        diretorioMunicipalId: prestadorBase.diretorioMunicipalId,
        status: MOVIMENTACAO_STATUS.PENDENTE_REVISAO,
        confiancaGlobal: 0.95,
        hashMovimento: hash,
      })
      .onConflictDoNothing()
      .returning();

    if (mov) {
      created += 1;
      if (tx.fonte_recurso || tx.natureza_recurso || tx.tipo_origem_recurso) {
        await db
          .insert(movimentacaoSpca)
          .values({
            movimentacaoId: mov.id,
            fonteRecurso: tx.fonte_recurso,
            naturezaRecurso: tx.natureza_recurso,
            tipoOrigemRecurso: tx.tipo_origem_recurso,
          })
          .onConflictDoNothing();
      }
    }
  }

  return created;
}
```

Ainda não remover o loop antigo — Task 4 substitui o bloco de query única.

- [ ] **Step 2: Typecheck**

```bash
cd packages/core && npm run lint
```

Expected: PASS (no type errors)

---

### Task 4: Loop query-per-PDF + erro parcial

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts:286-406`
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Write the failing test for two PDFs**

```ts
it("queries NotebookLM once per PDF and attributes movimentacoes to each arquivoIngestaoId", async () => {
  process.env.USE_NOTEBOOKLM = "true";
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
  expect(queryNotebookMock.mock.calls[0]![1]).toContain("extrato_a.pdf");
  expect(queryNotebookMock.mock.calls[1]![1]).toContain("extrato_b.pdf");
  expect(insertedArquivoIds).toEqual(["arq-a", "arq-b"]);
  expect(result.movimentacoesTotal).toBe(2);
  const byArquivo = Object.fromEntries(
    result.arquivos.map((a) => [a.arquivoId, a.movimentacoes_criadas ?? 0]),
  );
  expect(byArquivo["arq-a"]).toBe(1);
  expect(byArquivo["arq-b"]).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "queries NotebookLM once per PDF"
```

Expected: FAIL — `queryNotebookMock` called 1 time; both inserts use `arq-a`.

- [ ] **Step 3: Replace single-query block with per-PDF loop**

Substituir o bloco `if (processedSucessfully.length > 0) { ... }` (linhas 286–406) por:

```ts
  if (processedSucessfully.length > 0) {
    const allPFs = await db
      .select({ id: pessoaFisica.id, cpf: pessoaFisica.cpf, nome: pessoaFisica.nome })
      .from(pessoaFisica);
    const allPJs = await db
      .select({ id: pessoaJuridica.id, cnpj: pessoaJuridica.cnpj, nome: pessoaJuridica.razaoSocial })
      .from(pessoaJuridica);

    const persistCtxBase = {
      uf,
      exercicio,
      sessaoId,
      prestadorBase,
      allPFs,
      allPJs,
    };

    for (const arq of processedSucessfully) {
      try {
        const res = await queryNotebook(
          notebookId,
          buildNotebookLmExtratoPrompt(arq.nome),
        );
        const cleanJson = cleanJsonResponse(res.answer);

        let payload: NotebookLmPayload;
        try {
          payload = JSON.parse(cleanJson);
        } catch (parseErr) {
          throw new Error(
            `Failed to parse NotebookLM query output for ${arq.nome}: ${parseErr}\nResponse: ${res.answer}`,
          );
        }

        const transactions = payload.transacoes || [];
        for (const aviso of validateBalanceConsistency(payload, transactions)) {
          avisos.push(`[${arq.nome}] ${aviso}`);
        }

        const created = await persistNotebookLmTransactions(db, {
          ...persistCtxBase,
          arquivoIngestaoId: arq.arquivoId,
        }, transactions);

        arq.movimentacoes_criadas = created;
        totalMovs += created;

        if (transactions.length === 0) {
          avisos.push(`[${arq.nome}] Nenhuma transação extraída do extrato.`);
        }

        await db
          .update(arquivoIngestao)
          .set({ status: ARQUIVO_INGESTAO_STATUS.CONCLUIDO })
          .where(eq(arquivoIngestao.id, arq.arquivoId));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        arq.erro = message;
        avisos.push(`[${arq.nome}] Erro na extração: ${message}`);
        await db
          .update(arquivoIngestao)
          .set({
            status: ARQUIVO_INGESTAO_STATUS.ERRO,
            erroMensagem: message,
          })
          .where(eq(arquivoIngestao.id, arq.arquivoId));
      }
    }
  }
```

Remover o loop final que zerava `movimentacoes_criadas` em todos e atribuía tudo ao índice 0.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "queries NotebookLM once per PDF"
```

Expected: PASS

- [ ] **Step 5: Run full NotebookLM test file**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts
```

Expected: all tests PASS (ajustar testes existentes que esperam 1 query se necessário — o teste `should process session with NotebookLM` com 1 PDF continua com 1 query).

---

### Task 5: Teste de falha parcial no 2º PDF

**Files:**
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("marks second PDF as ERRO when its query fails but keeps first PDF movimentacoes", async () => {
  process.env.USE_NOTEBOOKLM = "true";
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
  expect(updateSets.some((s) => s.status === "ERRO" && s.erroMensagem?.includes("NLM timeout"))).toBe(true);
});
```

- [ ] **Step 2: Run test**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts -t "marks second PDF as ERRO"
```

Expected: PASS (implementação da Task 4 já cobre; se falhar, ajustar catch do loop).

---

### Task 6: Regressão completa do pacote core

**Files:** (nenhuma alteração — verificação)

- [ ] **Step 1: Run all core tests**

```bash
cd packages/core && npm test
```

Expected: all PASS

- [ ] **Step 2: Typecheck**

```bash
cd packages/core && npm run lint
```

Expected: PASS

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Filtro `.pdf` pendentes | Task 2 |
| `buildNotebookLmExtratoPrompt(nomeArquivo)` | Task 1 |
| Loop query → persist por PDF | Task 4 |
| `arquivoIngestaoId` correto | Task 3 + 4 |
| `movimentacoes_criadas` por arquivo | Task 4 |
| Erro parcial por PDF | Task 4 + 5 |
| Avisos com prefixo `[nomeArquivo]` | Task 4 |
| Consolidação inalterada | implícito (sem mudança em `run.ts`) |
| Testes 1 PDF / 2 PDFs / filtro / falha | Tasks 1–5 |

## Manual verification (pós-deploy)

1. Nova sessão BA 2025 com os dois extratos de janeiro.
2. SQL: `SELECT ai.nome_arquivo, count(*) FROM movimentacao m JOIN arquivo_ingestao ai ON ai.id = m.arquivo_ingestao_id WHERE m.sessao_prestacao_id = '<id>' GROUP BY ai.nome_arquivo` — duas linhas com count > 0.
3. Tela consolidação: eventos com PDFs distintos na coluna Documento.
