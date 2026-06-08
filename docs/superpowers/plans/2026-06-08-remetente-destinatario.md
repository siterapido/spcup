# Remetente/Destinatário — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** Substituir Nome por Remetente/Destinatário em mapa de colunas, schema IA, banco, API e planilha; valor só da coluna PDF ou edição manual; wipe domínio no deploy.

**Architecture:** Migration `RENAME COLUMN`; script `wipe-domain.ts` com guard `ALLOW_DOMAIN_WIPE`; rename em cascata `packages/core` (ingest, planilha, match, IA) + `apps/web` (wizard, planilha). Remove derivação (`deriveNomeContraparte` / `resolveNomeEffective`) dos fluxos de ingest e leitura. NotebookLM ganha campo `remetente_destinatario` na transação.

**Tech Stack:** TypeScript, Drizzle, Vitest, Next.js App Router, NotebookLM, OpenRouter.

**Spec:** [2026-06-08-remetente-destinatario-design.md](../specs/2026-06-08-remetente-destinatario-design.md)

---

## Arquivos (visão geral)

| Área | Arquivos principais |
|------|---------------------|
| Deploy | `scripts/wipe-domain.ts`, `packages/db/drizzle/0013_remetente_destinatario.sql` |
| DB | `packages/db/src/schema.ts`, `packages/db/drizzle/meta/_journal.json` |
| Mapa colunas | `packages/core/src/ingest/extrato-column-map.ts`, `apps/web/lib/extrato-column-map-client.ts` |
| IA | `packages/core/src/ai/openrouter/schemas.ts`, `packages/core/src/prestacao/process-sessao-notebooklm.ts` |
| Ingest | `packages/core/src/ingest/pdf.ts`, `packages/core/src/ingest/ofx.ts`, `packages/core/src/consolidacao/persist.ts` |
| Planilha | `packages/core/src/planilha/types.ts`, `list.ts`, `mutations.ts`, `status.ts`, `map-consolidacao-linha.ts` |
| Match | `packages/core/src/match/rules.ts` |
| API | `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts` |
| UI | `planilha-table.tsx`, `planilha-remetente-destinatario-cell.tsx`, `planilha-toolbar.tsx`, `use-extrato-column-map.ts` |
| Exports | `packages/core/src/index.ts`, `packages/core/src/browser.ts` |

---

### Task 1: Script wipe domínio

**Files:**
- Create: `scripts/wipe-domain.ts`
- Modify: `docs/dev-scripts.md`

- [ ] **Step 1: Criar script com guard**

`scripts/wipe-domain.ts`:

```typescript
/**
 * Wipe domínio operacional (prestação, pessoas, movimentações).
 * Run: ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts
 */
import { getDb } from "@spc-up/db";
import { sql } from "drizzle-orm";
import { config } from "dotenv";
import * as fs from "node:fs";

config();
if (fs.existsSync(".env.local")) {
  config({ path: ".env.local", override: true });
}

async function main() {
  if (process.env.ALLOW_DOMAIN_WIPE !== "1") {
    console.error("Defina ALLOW_DOMAIN_WIPE=1 para executar.");
    process.exit(1);
  }
  const db = getDb();
  console.log("Truncando domínio operacional...");
  await db.execute(sql`
    TRUNCATE TABLE
      cadastro_conflito,
      consolidacao_hipotese,
      consolidacao_linha,
      consolidacao_evento,
      match_evidencia,
      movimentacao_spca,
      doacao_financeira_link,
      movimentacao,
      ingestao_linha_pendente,
      ingestao_pagina,
      arquivo_ingestao,
      sessao_prestacao,
      conta_bancaria,
      pessoa_fisica,
      pessoa_juridica
    CASCADE;
  `);
  console.log("Domínio limpo. Preservados: usuario, diretorio_estadual, diretorio_municipal.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Documentar em dev-scripts**

Adicionar linha em `docs/dev-scripts.md`:

```markdown
| `scripts/wipe-domain.ts` | Wipe domínio (sessões, movimentações, pessoas). Requer `ALLOW_DOMAIN_WIPE=1` |
```

- [ ] **Step 3: Smoke (opcional, ambiente local)**

```bash
ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts
pnpm exec tsx scripts/list-db-state.ts
```

Expected: contagens de `movimentacao`, `sessao_prestacao`, `pessoa_fisica` = 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/wipe-domain.ts docs/dev-scripts.md
git commit -m "chore: add guarded domain wipe script"
```

---

### Task 2: Migration DB — rename coluna

**Files:**
- Create: `packages/db/drizzle/0013_remetente_destinatario.sql`
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/drizzle/meta/_journal.json` (entrada manual ou `drizzle-kit generate`)

- [ ] **Step 1: SQL migration**

`packages/db/drizzle/0013_remetente_destinatario.sql`:

```sql
ALTER TABLE "movimentacao" RENAME COLUMN "nome_contraparte" TO "remetente_destinatario";--> statement-breakpoint
ALTER TABLE "consolidacao_evento" RENAME COLUMN "nome_contraparte" TO "remetente_destinatario";
```

- [ ] **Step 2: Atualizar schema Drizzle**

Em `packages/db/src/schema.ts`, trocar em `movimentacao` e `consolidacao_evento`:

```typescript
remetenteDestinatario: varchar("remetente_destinatario", { length: 255 }),
```

(remover `nomeContraparte`)

- [ ] **Step 3: Aplicar migration local**

```bash
pnpm --filter @spc-up/db db:migrate
```

Expected: migration 0013 aplicada sem erro.

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): rename nome_contraparte to remetente_destinatario"
```

---

### Task 3: Mapa de colunas — `remetente_destinatario` + rejeitar `nome`

**Files:**
- Modify: `packages/core/src/ingest/extrato-column-map.ts`
- Modify: `packages/core/src/ingest/extrato-column-map.test.ts`
- Modify: `packages/core/src/index.ts` (exports se necessário)

- [ ] **Step 1: Testes falhando**

Em `extrato-column-map.test.ts`, substituir `nome` por `remetente_destinatario` em `validColunas` e adicionar:

```typescript
it("rejects map with legacy campo nome", () => {
  const r = parseExtratoColumnMap({
    paginaReferencia: 1,
    inferirDirecaoDoValor: true,
    colunas: [
      { campo: "data", colunaIndex: 0 },
      { campo: "valor", colunaIndex: 1 },
      { campo: "nome", colunaIndex: 2 },
      { campo: "historico", colunaIndex: 3 },
      { campo: "documento", colunaIndex: 4 },
    ],
  });
  expect(r).toBeNull();
});

it("rejects missing remetente_destinatario", () => {
  const r = validateExtratoColumnMap({
    paginaReferencia: 1,
    inferirDirecaoDoValor: true,
    colunas: validColunas.filter((c) => c.campo !== "remetente_destinatario"),
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.message).toContain("remetente_destinatario");
});
```

- [ ] **Step 2: Rodar — deve falhar**

```bash
cd packages/core && npm test -- src/ingest/extrato-column-map.test.ts
```

- [ ] **Step 3: Implementar**

Em `extrato-column-map.ts`:

```typescript
export const EXTRATO_COLUMN_MAP_CAMPOS_PADRAO = [
  "data",
  "valor",
  "direcao",
  "documento",
  "cpf_cnpj",
  "remetente_destinatario",
  "historico",
  // ...
] as const;

export const EXTRATO_SESSION_REQUIRED_CAMPOS = [
  "remetente_destinatario",
  "historico",
  "documento",
] as const;
```

Em `parseExtratoColumnMap`, após montar `colunas`:

```typescript
if (colunas.some((c) => c.campo === "nome")) {
  return null;
}
```

Atualizar mensagens de validação (`Falta mapear remetente_destinatario...`).

- [ ] **Step 4: Rodar testes**

```bash
cd packages/core && npm test -- src/ingest/extrato-column-map.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/extrato-column-map.ts packages/core/src/ingest/extrato-column-map.test.ts
git commit -m "feat(core): remetente_destinatario column map campo"
```

---

### Task 4: Auto-map cliente (wizard)

**Files:**
- Modify: `apps/web/lib/extrato-column-map-client.ts`
- Modify: `apps/web/hooks/use-extrato-column-map.ts`
- Modify: `apps/web/components/prestacao/extrato-column-map-panel.tsx` (labels se houver)

- [ ] **Step 1: Trocar auto-map**

Em `extrato-column-map-client.ts`:

```typescript
{
  campo: "remetente_destinatario",
  keywords: [
    "remetente",
    "destinatario",
    "destinatário",
    "remetente/destinatario",
    "remetente destinatario",
    "favorecido",
    "nome",
    "cliente",
    "origem",
    "destino",
    "razao social",
    "razão social",
  ],
},
```

(remover entrada `campo: "nome"`)

- [ ] **Step 2: Labels UI**

Onde o painel exibe rótulo do campo padrão, mapear:

```typescript
const CAMPO_LABELS: Record<string, string> = {
  remetente_destinatario: "Remetente/Destinatário",
  // ...
};
```

- [ ] **Step 3: Verificação manual**

Dev server → wizard etapa mapear → coluna com header "Remetente/Destinatário" auto-mapeia.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/extrato-column-map-client.ts apps/web/hooks/use-extrato-column-map.ts
git commit -m "feat(web): auto-map remetente_destinatario column"
```

---

### Task 5: Schema IA OpenRouter

**Files:**
- Modify: `packages/core/src/ai/openrouter/schemas.ts`
- Modify: `packages/core/src/ai/openrouter/extrato-column-hint.test.ts`
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts` (se usa `nome`)

- [ ] **Step 1: Renomear campo no schema**

Em `schemas.ts`, `EXTRATO_TRANSACTION_ITEM_SCHEMA`:

```typescript
remetente_destinatario: {
  type: ["string", "null"],
  description:
    "Nome na coluna Remetente/Destinatário do extrato; null se ausente. Um nome por linha.",
},
```

Trocar `"nome"` em `required` por `"remetente_destinatario"`. Atualizar `EXTRACTION_SCHEMA`, prompts `KIMI_EXTRATO_SYSTEM_PROMPT`, `GEMINI_EXTRATO_SYSTEM_PROMPT` e strings de exemplo JSON (`"remetente_destinatario":"..."`).

- [ ] **Step 2: Atualizar testes**

```bash
cd packages/core && npm test -- src/ai/openrouter
```

Corrigir fixtures que usam `nome:` → `remetente_destinatario:`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ai/
git commit -m "feat(core): IA schema remetente_destinatario"
```

---

### Task 6: Ingest PDF — sem derivação

**Files:**
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/ingest/pdf.test.ts` (se existir)
- Modify: `packages/core/src/ingest/types.ts`
- Modify: `packages/core/src/ingest/dual-extract.ts`
- Modify: `packages/core/src/ingest/pdf-pagina.ts`
- Modify: `packages/core/src/ingest/pdf-split.ts`

- [ ] **Step 1: Atualizar `ParsedTransactionRow`**

Em `types.ts`:

```typescript
remetenteDestinatario?: string | null;
```

(remover `nomeContraparte`)

- [ ] **Step 2: `rowFromExtratoItem` — só coluna**

```typescript
const rd =
  item.remetente_destinatario != null
    ? String(item.remetente_destinatario).trim()
    : "";
// descricaoRaw continua de descricao + docLabel; NÃO derivar rd de descricao
return {
  // ...
  remetenteDestinatario: rd.length >= 3 ? normalizeName(rd) : null,
};
```

Remover `nomeContraparteFromDescricao`. `rowFromExtratoItemSemDoc`: exigir `item.remetente_destinatario` (não `item.nome`).

- [ ] **Step 3: Testes**

```bash
cd packages/core && npm test -- src/ingest/pdf
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ingest/
git commit -m "feat(core): ingest pdf remetente_destinatario only"
```

---

### Task 7: NotebookLM — campo + persistência

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts`
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Prompt — adicionar campo**

No JSON de exemplo de `buildNotebookLmExtratoPrompt`:

```json
"remetente_destinatario": "Nome da coluna Remetente/Destinatário (ou null)",
```

Instrução: preencher **somente** da coluna mapeada `remetente_destinatario`, não da descrição.

- [ ] **Step 2: Interface + persist**

```typescript
interface NotebookLmTx {
  // ...
  remetente_destinatario: string | null;
}
```

Em `persistNotebookLmTransactions`, no `.values({...})`:

```typescript
remetenteDestinatario:
  tx.remetente_destinatario?.trim().length >= 3
    ? normalizeName(tx.remetente_destinatario.trim())
    : null,
```

- [ ] **Step 3: Testes**

```bash
cd packages/core && npm test -- src/prestacao/process-sessao-notebooklm.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/prestacao/process-sessao-notebooklm.ts
git commit -m "feat(core): notebooklm remetente_destinatario persist"
```

---

### Task 8: OFX + consolidação — sem derivação

**Files:**
- Modify: `packages/core/src/ingest/ofx.ts`
- Modify: `packages/core/src/consolidacao/persist.ts`
- Modify: `packages/core/src/consolidacao/approve.ts`
- Modify: `packages/core/src/consolidacao/queries.ts`

- [ ] **Step 1: OFX sempre null**

```typescript
remetenteDestinatario: null,
```

(remover `extractNomeContraparte`)

- [ ] **Step 2: Consolidação persist**

Trocar `deriveNomeContraparte(...)` por valor explícito das movimentações filhas (max não-vazio) ou null — **sem** parse de descrição:

```typescript
remetenteDestinatario: pickRemetenteDestinatarioFromFilhas(filhas), // null se todas null
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ingest/ofx.ts packages/core/src/consolidacao/
git commit -m "feat(core): no remetente derivation in ofx/consolidacao"
```

---

### Task 9: Planilha core — tipos e leitura

**Files:**
- Modify: `packages/core/src/planilha/types.ts`
- Modify: `packages/core/src/planilha/list.ts`
- Modify: `packages/core/src/planilha/map-consolidacao-linha.ts`
- Modify: `packages/core/src/planilha/status.ts`
- Modify: `packages/core/src/planilha/list.test.ts`
- Modify: `packages/core/src/planilha/status.test.ts`
- Modify: `packages/core/src/planilha/ingestao-resumo.test.ts`

- [ ] **Step 1: Novo shape `PlanilhaLinha`**

```typescript
export type PlanilhaLinha = {
  // ...
  remetenteDestinatario: string | null;
  // remover: nome, nomeContraparte, nomeDerivado
};

export type PlanilhaResumo = {
  // ...
  semRemetenteDestinatario: number; // era semNome
};
```

- [ ] **Step 2: `list.ts` — leitura direta**

```typescript
remetenteDestinatario: mov.remetenteDestinatario ?? null,
```

Remover `buildNomeFields` / `resolveNomeEffective`.

- [ ] **Step 3: `status.ts` — contador**

```typescript
if (!l.remetenteDestinatario || l.remetenteDestinatario.trim().length < 3) {
  semRemetenteDestinatario++;
}
```

- [ ] **Step 4: Testes**

```bash
cd packages/core && npm test -- src/planilha/
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planilha/
git commit -m "feat(core): planilha remetenteDestinatario types"
```

---

### Task 10: Planilha mutations + match

**Files:**
- Modify: `packages/core/src/planilha/mutations.ts`
- Modify: `packages/core/src/planilha/mutations.test.ts`
- Modify: `packages/core/src/match/rules.ts`
- Modify: `packages/core/src/match/rules.test.ts`

- [ ] **Step 1: Renomear update**

`updatePlanilhaLinhaNome` → `updatePlanilhaLinhaRemetenteDestinatario(db, linhaId, fonte, value)`.

Set `{ remetenteDestinatario: normalized }` em `movimentacao` / `consolidacao_evento`.

Re-match:

```typescript
const rd = evento.remetenteDestinatario;
if (rd && !isRemetenteDestinatarioVazio(rd)) {
  const byNome = await findUniquePessoaByNome(db, normalizeName(rd));
  // ...
}
```

Remover `resolveNomeEffective`.

- [ ] **Step 2: `rules.ts`**

`applyDeterministicMatch`: usar `mov.remetenteDestinatario` para match por nome (não derivar de descrição).

- [ ] **Step 3: Testes**

```bash
cd packages/core && npm test -- src/planilha/mutations.test.ts src/match/rules.test.ts
```

- [ ] **Step 4: Exports**

`packages/core/src/index.ts`: exportar `updatePlanilhaLinhaRemetenteDestinatario`; remover exports obsoletos de `deriveNomeContraparte` se não usados.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planilha/mutations.ts packages/core/src/match/rules.ts packages/core/src/index.ts
git commit -m "feat(core): mutations match remetenteDestinatario"
```

---

### Task 11: API PATCH breaking

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts`

- [ ] **Step 1: Zod + handler**

```typescript
const bodySchema = z.object({
  fonte: z.enum(["consolidacao", "movimentacao"]),
  remetenteDestinatario: z.string().max(255).nullable().optional(),
  // pessoa fields...
});
```

```typescript
if ("remetenteDestinatario" in body) {
  await updatePlanilhaLinhaRemetenteDestinatario(
    db,
    linhaId,
    fonte,
    body.remetenteDestinatario ?? null,
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts
git commit -m "feat(api): PATCH remetenteDestinatario only"
```

---

### Task 12: UI planilha

**Files:**
- Rename: `apps/web/components/prestacao/planilha-nome-cell.tsx` → `planilha-remetente-destinatario-cell.tsx`
- Modify: `apps/web/components/prestacao/planilha-table.tsx`
- Modify: `apps/web/components/prestacao/planilha-toolbar.tsx`

- [ ] **Step 1: Novo componente**

`planilha-remetente-destinatario-cell.tsx` — copiar de `planilha-nome-cell.tsx`:

- Props: `remetenteDestinatario`, `pessoaNome`
- PATCH body: `{ remetenteDestinatario }`
- Remover `nomeDerivado` e tooltip de derivado
- Manter `compararNomeCadastro(value, pessoaNome)`

- [ ] **Step 2: Tabela**

Header: `Remetente/Destinatário`. Passar `linha.remetenteDestinatario`.

- [ ] **Step 3: Toolbar**

```typescript
{ id: "sem_rd", label: "Sem remetente/destinatário", count: (r) => r.semRemetenteDestinatario },
```

- [ ] **Step 4: Apagar `planilha-nome-cell.tsx`**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/prestacao/
git commit -m "feat(web): planilha Remetente/Destinatario column"
```

---

### Task 13: Varredura final + testes

**Files:** grep residual `nomeContraparte`, `nome_contraparte`, `campo: "nome"` em código prod (exceto `pessoa.nome`, cadastro, diretório)

- [ ] **Step 1: Buscar resíduos**

```bash
rg "nomeContraparte|nome_contraparte|nomeDerivado|deriveNomeContraparte" packages apps --glob '!**/docs/**'
```

Corrigir: `map-consolidacao-linha.ts`, `packages/core/src/planilha/map-consolidacao-linha.ts`, CLI, testes integração.

- [ ] **Step 2: Suite core**

```bash
cd packages/core && npm test
```

Expected: PASS

- [ ] **Step 3: Typecheck web**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remetente_destinatario rename sweep"
```

---

### Task 14: Deploy checklist

- [x] **Step 1: Ordem deploy**

1. `ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts`
2. `pnpm --filter @spc-up/db db:migrate`
3. Deploy app

- [x] **Step 2: Smoke pós-deploy**

1. Importar cadastro pessoas
2. Nova prestação com PDF coluna Remetente/Destinatário
3. Mapear `remetente_destinatario`
4. Processar → planilha preenchida
5. Vincular PF/PJ → bolinha verde/âmbar

Documentado em [`docs/dev-scripts.md`](../../dev-scripts.md#deploy-remetente_destinatario).

---

## Mapa spec → tasks

| Requisito spec | Task |
|----------------|------|
| Wipe domínio | 1, 14 |
| Migration DB | 2 |
| Mapa `remetente_destinatario` | 3, 4 |
| Rejeitar `nome` no mapa | 3 |
| Schema IA | 5, 6, 7 |
| Sem derivação | 6, 8, 9 |
| Planilha + API breaking | 9, 10, 11, 12 |
| Match cadastro C | 10, 12 |
| OFX null | 8 |

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| NotebookLM ignora coluna | Hint `buildExtratoColumnPromptHint` + campo explícito no prompt |
| Wipe acidental | `ALLOW_DOMAIN_WIPE=1` |
| Testes com `nome` legado | Task 13 grep |
