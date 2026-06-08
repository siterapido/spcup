# Plano de Implementação: Desativação do OpenRouter por Padrão

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desativar todas as chamadas ao OpenRouter por padrão no sistema SPC-UP, introduzindo uma flag global `DISABLE_OPENROUTER=true` com fallbacks locais determinísticos e erros amigáveis.

**Architecture:** Centralizar a verificação da flag `DISABLE_OPENROUTER === "true"` no cliente OpenRouter (`callOpenRouterJson`), no módulo de conciliação de rascunhos (`enrichAmbiguousWithAi`) e no endpoint HTTP de reprocessamento, garantindo que o sistema funcione localmente sem chaves externas de forma segura.

**Tech Stack:** TypeScript, Node.js, Next.js, Drizzle ORM.

---

### Task 1: Configuração da Variável de Ambiente

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Adicionar a flag `DISABLE_OPENROUTER` no arquivo `.env.example`**

Adicionar a flag `DISABLE_OPENROUTER=true` no arquivo `.env.example` para documentar a nova configuração padrão.

```ini
# Desativa todas as chamadas de rede para o OpenRouter
DISABLE_OPENROUTER=true
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "config: add DISABLE_OPENROUTER to .env.example"
```

---

### Task 2: Centralizar Bloqueio no Cliente OpenRouter

**Files:**
- Modify: `packages/core/src/ai/openrouter/client.ts`
- Test: `packages/core/src/ai/openrouter.test.ts`

- [ ] **Step 1: Adicionar validação de `DISABLE_OPENROUTER` no topo de `callOpenRouterJson`**

```typescript
export async function callOpenRouterJson(
  payload: Record<string, unknown>,
  options?: ExtractStructuredOptions,
): Promise<OpenRouterJsonResult> {
  if (process.env.DISABLE_OPENROUTER === "true") {
    throw new Error(
      "OpenRouter está desativado (DISABLE_OPENROUTER=true). Ative o NotebookLM (USE_NOTEBOOKLM=true) ou habilite o OpenRouter (DISABLE_OPENROUTER=false)."
    );
  }
  const apiKey = resolveOpenRouterApiKey(options?.apiKey);
  // ... resto do código ...
```

- [ ] **Step 2: Escrever teste unitário para validar o bloqueio**

No arquivo `packages/core/src/ai/openrouter.test.ts`, adicionar um teste que define `process.env.DISABLE_OPENROUTER = "true"` e garante que `extractStructuredFromPdf` ou `callOpenRouterJson` lança o erro esperado.

- [ ] **Step 3: Executar os testes do OpenRouter**

Run: `npx vitest run packages/core/src/ai/openrouter.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ai/openrouter/client.ts packages/core/src/ai/openrouter.test.ts
git commit -m "feat: block OpenRouter calls when DISABLE_OPENROUTER is true"
```

---

### Task 3: Ignorar Enriquecimento de Conciliação com OpenRouter Desativado

**Files:**
- Modify: `packages/core/src/consolidacao/ai.ts`

- [ ] **Step 1: Adicionar verificação de `DISABLE_OPENROUTER` em `enrichAmbiguousWithAi`**

```typescript
export async function enrichAmbiguousWithAi(
  db: Db,
  drafts: ConsolidacaoEventDraft[],
  _movs: MovimentacaoCandidate[],
  sessaoCtx: SessaoContext,
): Promise<ConsolidacaoEventDraft[]> {
  if (process.env.DISABLE_OPENROUTER === "true" || !process.env.OPENROUTER_API_KEY) {
    return drafts;
  }
  // ... resto do código ...
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/consolidacao/ai.ts
git commit -m "feat: bypass AI enrichment in consolidation when OpenRouter is disabled"
```

---

### Task 4: Desativar Endpoint de Reprocessamento por IA na Web

**Files:**
- Modify: `apps/web/app/api/movimentacoes/[id]/reprocessar-ia/route.ts`

- [ ] **Step 1: Adicionar verificação de `DISABLE_OPENROUTER` no handler POST**

```typescript
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  if (process.env.DISABLE_OPENROUTER === "true") {
    return NextResponse.json(
      { error: "O serviço de reprocessamento por IA (OpenRouter) está desativado nesta instância." },
      { status: 400 }
    );
  }

  const { id } = await context.params;
  // ... resto do código ...
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/movimentacoes/[id]/reprocessar-ia/route.ts
git commit -m "feat: disable reprocessar-ia web endpoint when OpenRouter is disabled"
```

---

### Task 5: Validação Geral e Testes de Regressão

**Files:**
- Test: `packages/core/src/consolidacao/auto.test.ts`
- Test: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Rodar testes locais para garantir que nada quebrou**

Executar os testes unitários principais do sistema para garantir estabilidade offline.

Run: `npx vitest run packages/core/src/consolidacao/auto.test.ts`
Expected: PASS

Run: `npx vitest run packages/core/src/prestacao/process-sessao-notebooklm.test.ts`
Expected: PASS

- [ ] **Step 2: Commit**

```bash
git commit --allow-empty -m "test: verify all offline tests pass successfully"
```
