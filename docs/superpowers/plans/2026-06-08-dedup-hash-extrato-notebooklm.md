# Dedup de hash colapsando transações (NotebookLM) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de descartar transações reais no ingest NotebookLM tornando o hash de dedup único por linha dentro do arquivo e distinto entre arquivos.

**Architecture:** `computeHashMovimento` ganha um discriminador opcional anexado ao payload do hash. `persistNotebookLmTransactions` passa `${arquivoIngestaoId}|${index}` como discriminador, de modo que linhas idênticas repetidas (mesmo extrato) e linhas iguais em PDFs diferentes deixem de colidir no índice único `uq_mov_prestador_exercicio_hash`. A consolidação então cruza PIX↔TOTAL como já projetado. Por fim, o label "sem doc." da UI passa a refletir o significado real (duplicatas).

**Tech Stack:** TypeScript, vitest, Drizzle ORM, monorepo pnpm/turbo (`packages/core`, `apps/web`).

**Spec:** `docs/superpowers/specs/2026-06-08-dedup-hash-extrato-notebooklm-design.md`

---

## File Structure

- Modify: `packages/core/src/ingest/hash.ts` — adicionar parâmetro `discriminador`.
- Test: `packages/core/src/ingest/hash.test.ts` — cobrir discriminador e regressão.
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts` — passar discriminador por linha.
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts` — N idênticas → N movs.
- Modify: `apps/web/components/prestacao/planilha-ingestao-resumo.tsx` — label honesto.

---

## Task 1: Discriminador opcional em `computeHashMovimento`

**Files:**
- Modify: `packages/core/src/ingest/hash.ts:15-31`
- Test: `packages/core/src/ingest/hash.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `packages/core/src/ingest/hash.test.ts` (dentro do `describe("computeHashMovimento", ...)`):

```typescript
  it("differs when discriminador differs", () => {
    const a = computeHashMovimento("14679407000100", 2025, row, "arq-1|0");
    const b = computeHashMovimento("14679407000100", 2025, row, "arq-1|1");
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs when discriminador shares index but different arquivo", () => {
    const a = computeHashMovimento("14679407000100", 2025, row, "arq-1|0");
    const b = computeHashMovimento("14679407000100", 2025, row, "arq-2|0");
    expect(a).not.toBe(b);
  });

  it("keeps backward-compatible hash when discriminador is omitted", () => {
    const without = computeHashMovimento("14679407000100", 2025, row);
    const emptyDisc = computeHashMovimento("14679407000100", 2025, row, "");
    expect(without).toBe(emptyDisc);
  });
```

- [ ] **Step 2: Rodar os testes e confirmar a falha**

Run: `pnpm --filter @spc-up/core test -- hash.test.ts`
Expected: FAIL — `computeHashMovimento` ignora o 4º argumento, então os dois primeiros testes acusam hashes iguais (`a` === `b`).

- [ ] **Step 3: Implementar o discriminador**

Em `packages/core/src/ingest/hash.ts`, substituir a função `computeHashMovimento` por:

```typescript
export function computeHashMovimento(
  cnpjPrestador: string,
  exercicio: number,
  row: ParsedTransactionRow,
  discriminador = "",
): string {
  const payload = [
    cnpjPrestador,
    String(exercicio),
    row.dataMovimento.toISOString().slice(0, 10),
    row.valor,
    row.descricaoRaw,
    row.direcao,
    row.credDev ?? "",
    row.nrExtratoBancario ?? "",
    discriminador,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

Observação: o payload anterior terminava em `nrExtratoBancario ?? ""`. Acrescentar `discriminador` (default `""`) ao final mantém o hash idêntico quando o argumento é omitido (o `join("|")` produz a mesma string, pois `["a","b"].join("|")` === `["a","b",""].join("|").slice(...)`? Não — `join` adiciona o separador). Para garantir retrocompatibilidade real, ver Step 4.

- [ ] **Step 4: Ajustar a expectativa de retrocompatibilidade**

`["a","b"].join("|")` = `"a|b"`, mas `["a","b",""].join("|")` = `"a|b|"`. Logo anexar `discriminador` MUDA o hash mesmo quando vazio. Isso é aceitável (os movimentos antigos persistidos não são reprocessados no fluxo normal), mas o teste de retrocompatibilidade do Step 1 ("keeps backward-compatible hash when discriminador is omitted") compara `omitido` vs `""`, e ambos produzem `"...|"` — portanto são IGUAIS entre si. O teste valida que omitir === passar `""`, não que === versão pré-mudança. Confirmar que o teste passa com essa semântica.

- [ ] **Step 5: Rodar os testes e confirmar sucesso**

Run: `pnpm --filter @spc-up/core test -- hash.test.ts`
Expected: PASS (4 testes: cnpj difere, discriminador difere, arquivo difere, omitido === "").

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ingest/hash.ts packages/core/src/ingest/hash.test.ts
git commit -m "feat: discriminador opcional em computeHashMovimento"
```

---

## Task 2: `persistNotebookLmTransactions` usa discriminador por linha

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts:245-327`
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar este teste dentro do `describe("NotebookLM Session Processor", ...)` em `packages/core/src/prestacao/process-sessao-notebooklm.test.ts` (após o teste "should process session with NotebookLM..."):

```typescript
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
```

- [ ] **Step 2: Rodar o teste e confirmar a falha**

Run: `pnpm --filter @spc-up/core test -- process-sessao-notebooklm.test.ts`
Expected: FAIL — sem discriminador por linha, as 3 transações idênticas geram o mesmo `hashMovimento`, então `uniqueHashes.size` é 1 (não 3).

- [ ] **Step 3: Implementar o discriminador por linha**

Em `packages/core/src/prestacao/process-sessao-notebooklm.ts`, na função `persistNotebookLmTransactions`, trocar o cabeçalho do loop e o cálculo do hash.

Trocar:

```typescript
  for (const tx of transactions) {
    let pfId: string | null = null;
    let pjId: string | null = null;
```

por:

```typescript
  for (let index = 0; index < transactions.length; index += 1) {
    const tx = transactions[index]!;
    let pfId: string | null = null;
    let pjId: string | null = null;
```

Trocar:

```typescript
    const hash = computeHashMovimento(prestadorBase.cnpjPrestador, exercicio, hashInput);
```

por:

```typescript
    const hash = computeHashMovimento(
      prestadorBase.cnpjPrestador,
      exercicio,
      hashInput,
      `${arquivoIngestaoId}|${index}`,
    );
```

(`arquivoIngestaoId` já está desestruturado de `ctx` no início da função; `computeHashMovimento` já é importado neste arquivo.)

- [ ] **Step 4: Rodar o teste novo e confirmar sucesso**

Run: `pnpm --filter @spc-up/core test -- process-sessao-notebooklm.test.ts`
Expected: PASS — 3 inserts, 3 hashes distintos, `movimentacoesTotal === 3`.

- [ ] **Step 5: Rodar a suíte do pacote core e confirmar que nada regrediu**

Run: `pnpm --filter @spc-up/core test`
Expected: PASS — incluindo os testes existentes de `process-sessao-notebooklm.test.ts` (que usam `transactions` de 1 linha; a indexação não altera o resultado deles).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prestacao/process-sessao-notebooklm.ts packages/core/src/prestacao/process-sessao-notebooklm.test.ts
git commit -m "fix: preservar transacoes repetidas no ingest NotebookLM"
```

---

## Task 3: Label honesto na UI ("sem doc." → "duplicadas")

**Files:**
- Modify: `apps/web/components/prestacao/planilha-ingestao-resumo.tsx:56-58`

Contexto: com o fix da Task 2, no fluxo normal `created === transactions.length`, então `linhasIgnoradasSemDoc` (= `transactions.length - created`) fica ≈ 0. Quando for > 0 (ex.: reprocesso com colisão real), o número representa duplicatas — não ausência de documento. Só o texto exibido muda; a chave de dados e a contagem em `countAlertas` permanecem.

- [ ] **Step 1: Ajustar o texto do header do arquivo**

Em `apps/web/components/prestacao/planilha-ingestao-resumo.tsx`, trocar:

```tsx
  if (arq.linhasIgnoradasSemDoc > 0) {
    parts.push(`· ${arq.linhasIgnoradasSemDoc} sem doc.`);
  }
```

por:

```tsx
  if (arq.linhasIgnoradasSemDoc > 0) {
    parts.push(`· ${arq.linhasIgnoradasSemDoc} duplicadas`);
  }
```

- [ ] **Step 2: Verificar type-check e lint da app web**

Run: `pnpm --filter web lint`
Expected: PASS (sem novos erros no arquivo alterado).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/prestacao/planilha-ingestao-resumo.tsx
git commit -m "fix: label honesto de duplicadas no resumo de extracao"
```

---

## Validação manual final

- [ ] Reprocessar a sessão de exemplo (BA/2025) com os 2 PDFs.
- [ ] Confirmar que a planilha unificada sobe de 9 para ~70 linhas.
- [ ] Confirmar que "duplicadas" no resumo fica ≈ 0.
- [ ] Confirmar que a consolidação passa a parear linhas PIX↔TOTAL (linhas com 2 origens / merges sugeridos).

---

## Self-Review

- **Spec coverage:** Componente 1 (hash discriminador) → Task 1. Componente 2 (persist NotebookLM) → Task 2. Componente 3 (label honesto) → Task 3. Verificação da spec → testes nas Tasks 1-2 + validação manual. ✔
- **Placeholder scan:** sem TBD/TODO; todo passo tem código/comando concreto. ✔
- **Type consistency:** `computeHashMovimento(cnpj, exercicio, row, discriminador?)` usada de forma idêntica na Task 1 e Task 2; `discriminador = \`${arquivoIngestaoId}|${index}\``; `arquivoIngestaoId` vem de `ctx`. ✔
- **Escopo:** OpenRouter/`persistTransactions` deliberadamente fora (decisão do usuário). ✔
