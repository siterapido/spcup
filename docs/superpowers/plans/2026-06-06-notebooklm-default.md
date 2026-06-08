# NotebookLM como Padrão por Código e Configuração - Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurar o NotebookLM como o pipeline padrão e obrigatório de processamento de extratos bancários na interface Web e Core do sistema SPC-UP, desativando chamadas ao OpenRouter por padrão.

**Architecture:** Substituir todas as checagens estritas de `USE_NOTEBOOKLM === "true"` por `USE_NOTEBOOKLM !== "false"`, garantindo que o sistema use o NotebookLM por padrão mesmo sem configuração explícita, mantendo consistência entre os endpoints web e o core do sistema.

**Tech Stack:** TypeScript, Next.js, Node.js, Vitest.

---

### Task 1: Core - Modificar Checagens de NotebookLM para Novo Padrão

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao.ts`
- Modify: `packages/core/src/ingest/pipeline.ts`
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Adicionar teste unitário de regressão para verificar padrão sem variável de ambiente**

No arquivo `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`, adicionar um teste unitário para validar que, ao processar sem definir explicitamente a variável `process.env.USE_NOTEBOOKLM` (ou quando ela for undefined), o fluxo de NotebookLM ainda seja disparado.

Adicionar no topo do bloco de testes:
```typescript
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
    queryNotebookMock.mockResolvedValue({ text: mockAnswer });

    const result = await processSessaoPdfArquivos(db, "sess-nb-1");
    expect(result.sessaoId).toBe("sess-nb-1");
    expect(getOrCreateNotebookMock).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Executar testes para certificar que o novo teste falha (TDD)**

Executar os testes:
Run: `npx vitest run packages/core/src/prestacao/process-sessao-notebooklm.test.ts`
Expected: FAIL (o teste adicionado deve tentar executar o fluxo de página tradicional ou falhar porque tenta usar o OpenRouter, que está bloqueado ou não mockado apropriadamente).

- [ ] **Step 3: Modificar checagem em `packages/core/src/prestacao/process-sessao.ts`**

Alterar a checagem na linha 63 de:
```typescript
  if (process.env.USE_NOTEBOOKLM === "true") {
```
Para:
```typescript
  if (process.env.USE_NOTEBOOKLM !== "false") {
```

- [ ] **Step 4: Modificar checagens em `packages/core/src/ingest/pipeline.ts`**

Substituir as ocorrências de `process.env.USE_NOTEBOOKLM === "true"` (linhas 143 e 296) por `process.env.USE_NOTEBOOKLM !== "false"`.

Linha 143:
```typescript
    if (process.env.USE_NOTEBOOKLM !== "false") {
      await db
        .update(arquivoIngestao)
```

Linha 296:
```typescript
    if (process.env.USE_NOTEBOOKLM !== "false") {
      await db
        .update(arquivoIngestao)
```

- [ ] **Step 5: Executar testes locais para verificar sucesso**

Executar a suíte de testes do processador de sessões:
Run: `npx vitest run packages/core/src/prestacao/process-sessao-notebooklm.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/prestacao/process-sessao.ts packages/core/src/ingest/pipeline.ts packages/core/src/prestacao/process-sessao-notebooklm.test.ts
git commit -m "feat(core): set NotebookLM as default pipeline (USE_NOTEBOOKLM !== false)"
```

---

### Task 2: Web API - Atualizar Endpoint de Upload

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`

- [ ] **Step 1: Atualizar retorno de `useNotebookLm` para usar nova checagem**

No arquivo `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`, atualizar as linhas 65 e 73 para retornar `useNotebookLm` ativo por padrão.

Linha 65:
```typescript
        useNotebookLm: process.env.USE_NOTEBOOKLM !== "false",
```

Linha 73:
```typescript
    useNotebookLm: process.env.USE_NOTEBOOKLM !== "false",
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts
git commit -m "feat(web): update upload API to return useNotebookLm true by default"
```

---

### Task 3: Configuração de Variáveis de Ambiente

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Documentar as novas variáveis no `.env.example`**

Garantir que as flags `USE_NOTEBOOKLM` e `DISABLE_OPENROUTER` estejam configuradas como `true` por padrão no arquivo `.env.example`.

Substituir se necessário ou adicionar:
```ini
USE_NOTEBOOKLM=true
DISABLE_OPENROUTER=true
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "config: set USE_NOTEBOOKLM and DISABLE_OPENROUTER to true in .env.example"
```
