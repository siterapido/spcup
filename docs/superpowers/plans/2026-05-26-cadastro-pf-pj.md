# Cadastro PF/PJ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro nacional de PF/PJ com importação em planilha, cadastro manual, fila de conflitos de nome, re-match de movimentações pendentes por UF/exercício, e perfil com histórico transacional completo.

**Architecture:** Lógica em `packages/core/src/cadastro/*`; nova tabela `cadastro_conflito` no Drizzle; APIs Next.js em `apps/web/app/api/pessoas/*`; páginas em `apps/web/app/pessoas/*`. Reutiliza `normalize*` e `applyDeterministicMatch`.

**Tech Stack:** TypeScript, Drizzle ORM, Neon Postgres, Next.js 15 App Router, ExcelJS (já no core), Vitest.

**Spec:** [docs/superpowers/specs/2026-05-26-cadastro-pf-pj-design.md](../specs/2026-05-26-cadastro-pf-pj-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema.ts` | Tabela `cadastro_conflito`, relations, exports de tipos |
| `packages/core/src/cadastro/types.ts` | `CadastroTipo`, linhas parseadas, resultados de import |
| `packages/core/src/cadastro/constants.ts` | Stubs, status conflito, mapa de `tipo` da planilha |
| `packages/core/src/cadastro/parse.ts` | `parseCadastroSpreadsheet` (xlsx/csv) |
| `packages/core/src/cadastro/upsert.ts` | `upsertPessoa`, `isStubNome` |
| `packages/core/src/cadastro/import.ts` | `importCadastroBatch` |
| `packages/core/src/cadastro/rematch.ts` | `rematchPendingMovimentacoes` |
| `packages/core/src/cadastro/conflitos.ts` | `resolveCadastroConflito`, listagem |
| `packages/core/src/cadastro/query.ts` | `searchPessoas`, `getPessoa`, `listPessoaMovimentacoes` |
| `packages/core/src/match/rules.ts` | Evidência `CPF_CADASTRO` / `CNPJ_CADASTRO` |
| `apps/web/lib/mask-document.ts` | Máscara CPF/CNPJ na UI |
| `apps/web/app/api/pessoas/**` | REST handlers |
| `apps/web/app/pessoas/**` | Páginas + componentes client |

---

### Task 1: Schema `cadastro_conflito`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: migration via `pnpm db:generate`

- [ ] **Step 1: Add table and relations in schema**

Add after `pessoaJuridica` definition:

```typescript
export const CADASTRO_CONFLITO_STATUS = {
  PENDENTE: "PENDENTE",
  RESOLVIDO: "RESOLVIDO",
  IGNORADO: "IGNORADO",
} as const;

export const CADASTRO_CONFLITO_RESOLUCAO = {
  MANTER_NOME: "MANTER_NOME",
  ATUALIZAR_NOME: "ATUALIZAR_NOME",
} as const;

export const cadastroConflito = pgTable(
  "cadastro_conflito",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tipo: varchar("tipo", { length: 2 }).notNull(),
    documento: varchar("documento", { length: 14 }).notNull(),
    nomeExistente: varchar("nome_existente", { length: 255 }).notNull(),
    nomeProposto: varchar("nome_proposto", { length: 255 }).notNull(),
    origem: varchar("origem", { length: 10 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDENTE"),
    resolucao: varchar("resolucao", { length: 20 }),
    ufContexto: varchar("uf_contexto", { length: 2 }).notNull(),
    exercicioContexto: integer("exercicio_contexto").notNull(),
    pessoaFisicaId: uuid("pessoa_fisica_id").references(() => pessoaFisica.id),
    pessoaJuridicaId: uuid("pessoa_juridica_id").references(() => pessoaJuridica.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("ix_cadastro_conflito_status").on(table.status)],
);

export const cadastroConflitoRelations = relations(cadastroConflito, ({ one }) => ({
  pessoaFisica: one(pessoaFisica, {
    fields: [cadastroConflito.pessoaFisicaId],
    references: [pessoaFisica.id],
  }),
  pessoaJuridica: one(pessoaJuridica, {
    fields: [cadastroConflito.pessoaJuridicaId],
    references: [pessoaJuridica.id],
  }),
}));
```

Export types `CadastroConflito`, `NewCadastroConflito` at bottom of file. Re-export table from `packages/db/src/index.ts` if not barrel-exported automatically.

- [ ] **Step 2: Generate and apply migration**

Run from repo root:

```bash
pnpm db:generate
pnpm db:migrate
```

Expected: new SQL file `packages/db/drizzle/0001_*.sql` creating `cadastro_conflito`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/src/index.ts
git commit -m "feat(db): add cadastro_conflito table for PF/PJ name conflicts"
```

---

### Task 2: Cadastro constants and types

**Files:**
- Create: `packages/core/src/cadastro/types.ts`
- Create: `packages/core/src/cadastro/constants.ts`

- [ ] **Step 1: Create constants**

`packages/core/src/cadastro/constants.ts`:

```typescript
export const STUB_PF_NOME = "DESCONHECIDO";
export const STUB_PJ_RAZAO = "DESCONHECIDA";

export const CADASTRO_TIPO = { PF: "PF", PJ: "PJ" } as const;
export type CadastroTipo = (typeof CADASTRO_TIPO)[keyof typeof CADASTRO_TIPO];

const TIPO_ALIASES: Record<string, CadastroTipo> = {
  PF: "PF",
  PJ: "PJ",
  FISICA: "PF",
  JURIDICA: "PJ",
  PESSOA_FISICA: "PF",
  PESSOA_JURIDICA: "PJ",
};

export function parseCadastroTipo(raw: string): CadastroTipo | null {
  const key = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return TIPO_ALIASES[key] ?? null;
}

export function isStubNome(tipo: CadastroTipo, nome: string): boolean {
  const n = nome.trim().toUpperCase();
  return tipo === "PF" ? n === STUB_PF_NOME : n === STUB_PJ_RAZAO;
}
```

- [ ] **Step 2: Create types**

`packages/core/src/cadastro/types.ts`:

```typescript
import type { CadastroTipo } from "./constants";

export interface CadastroRow {
  linha: number;
  tipo: CadastroTipo;
  documento: string;
  nome: string;
}

export interface UpsertPessoaResult {
  action: "inserted" | "updated" | "unchanged" | "conflict";
  pessoaFisicaId?: string;
  pessoaJuridicaId?: string;
  conflitoId?: string;
}

export interface ImportCadastroResult {
  inseridos: number;
  atualizados: number;
  ignorados: number;
  conflitos: number;
  erros: Array<{ linha: number; motivo: string }>;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/cadastro/constants.ts packages/core/src/cadastro/types.ts
git commit -m "feat(core): cadastro PF/PJ types and constants"
```

---

### Task 3: Parse spreadsheet (TDD)

**Files:**
- Create: `packages/core/src/cadastro/parse.ts`
- Create: `packages/core/src/cadastro/parse.test.ts`
- Create: `packages/core/fixtures/cadastro-sample.xlsx` (3 rows: PF, PJ, invalid tipo)

- [ ] **Step 1: Write failing tests**

`packages/core/src/cadastro/parse.test.ts`:

```typescript
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseCadastroSpreadsheet } from "./parse";

describe("parseCadastroSpreadsheet", () => {
  it("parses xlsx with tipo documento nome", async () => {
    const buf = await readFile(
      path.join(__dirname, "../../fixtures/cadastro-sample.xlsx"),
    );
    const rows = await parseCadastroSpreadsheet(buf, "cadastro-sample.xlsx");
    expect(rows.ok).toHaveLength(2);
    expect(rows.ok[0]?.tipo).toBe("PF");
    expect(rows.ok[0]?.documento).toBe("12345678909");
    expect(rows.erros).toHaveLength(1);
  });

  it("rejects buffer without required headers", async () => {
    const csv = Buffer.from("foo,bar\n1,2", "utf8");
    await expect(
      parseCadastroSpreadsheet(csv, "bad.csv"),
    ).rejects.toThrow(/tipo/i);
  });
});
```

Create fixture xlsx manually or via small script in test setup with ExcelJS (header row + 2 valid + 1 bad tipo).

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @spc-up/core test src/cadastro/parse.test.ts
```

- [ ] **Step 3: Implement parse**

`packages/core/src/cadastro/parse.ts` — mirror header detection from `ingest/excel.ts` but columns `tipo`, `documento`, `nome`. Support `.xlsx`/`.xls` via ExcelJS; `.csv` split by `,` or `;` on first line. For each data row: `parseCadastroTipo`, `normalizeCpf`/`normalizeCnpj`, `normalizeName`. Push to `ok` or `erros` with `linha` (1-based, incl. header).

Return type:

```typescript
export interface ParseCadastroResult {
  ok: CadastroRow[];
  erros: Array<{ linha: number; motivo: string }>;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cadastro/parse.ts packages/core/src/cadastro/parse.test.ts packages/core/fixtures/cadastro-sample.xlsx
git commit -m "feat(core): parse cadastro spreadsheet"
```

---

### Task 4: upsertPessoa (TDD)

**Files:**
- Create: `packages/core/src/cadastro/upsert.ts`
- Create: `packages/core/src/cadastro/upsert.test.ts`

- [ ] **Step 1: Write failing tests** (mock `Db` like `match/rules.test.ts`)

Cases:
1. New CPF → `inserted`
2. Same CPF + same nome → `unchanged`
3. Stub + new nome → `updated`
4. Real nome different → `conflict` + insert into `cadastroConflito`

Use CPF de teste válido `12345678909` (já usado no projeto).

- [ ] **Step 2: Run tests — FAIL**

- [ ] **Step 3: Implement `upsertPessoa`**

Signature:

```typescript
export interface UpsertPessoaContext {
  uf: string;
  exercicio: number;
  origem: "IMPORT" | "MANUAL";
}

export async function upsertPessoa(
  db: Db,
  row: Pick<CadastroRow, "tipo" | "documento" | "nome">,
  ctx: UpsertPessoaContext,
): Promise<UpsertPessoaResult>
```

Logic per spec §6. On conflict, `insert cadastroConflito` with FK to existing pessoa.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): upsert pessoa with conflict detection"
```

---

### Task 5: importCadastroBatch + rematch (TDD)

**Files:**
- Create: `packages/core/src/cadastro/import.ts`
- Create: `packages/core/src/cadastro/rematch.ts`
- Create: `packages/core/src/cadastro/import.test.ts`
- Create: `packages/core/src/cadastro/rematch.test.ts`

- [ ] **Step 1: Test `importCadastroBatch`**

Mock `upsertPessoa`; verify counters `inseridos`, `conflitos`, `erros` aggregation.

- [ ] **Step 2: Implement import**

```typescript
export async function importCadastroBatch(
  db: Db,
  rows: CadastroRow[],
  uf: string,
  exercicio: number,
): Promise<ImportCadastroResult>
```

After loop, if `inseridos + atualizados > 0`, call `rematchPendingMovimentacoes`.

- [ ] **Step 3: Test rematch**

DB mock with 2 movimentações: one with CPF in desc + stub pessoa, one without doc. After `rematchPendingMovimentacoes`, expect `applyDeterministicMatch` called (spy) or update mock returning linked PF.

- [ ] **Step 4: Implement rematch**

```typescript
export async function rematchPendingMovimentacoes(
  db: Db,
  uf: string,
  exercicio: number,
): Promise<{ processed: number }>
```

Query movimentações where:
- `uf`, `exercicio` match
- `status` in `RASCUNHO`, `PENDENTE_REVISAO`
- Join pessoa; include if null OR stub nome
- Filter in JS with `extractDocumentCandidates(descricaoRaw).length > 0`
- Loop `applyDeterministicMatch(db, id)`

- [ ] **Step 5: Run all core cadastro tests — PASS**

```bash
pnpm --filter @spc-up/core test
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(core): cadastro batch import and pending rematch"
```

---

### Task 6: resolveCadastroConflito + queries

**Files:**
- Create: `packages/core/src/cadastro/conflitos.ts`
- Create: `packages/core/src/cadastro/query.ts`
- Create: `packages/core/src/cadastro/conflitos.test.ts`
- Create: `packages/core/src/cadastro/index.ts`

- [ ] **Step 1: Test resolve**

`ATUALIZAR_NOME` updates `pessoa_fisica.nome` or `pessoa_juridica.razao_social`, sets conflict `RESOLVIDO`, calls rematch.

`MANTER_NOME` / `IGNORADO` — no name update; rematch only for `ATUALIZAR_NOME`.

- [ ] **Step 2: Implement `resolveCadastroConflito(db, id, resolucao)`**

- [ ] **Step 3: Implement query helpers**

```typescript
export async function searchPessoas(db: Db, q: string, tipo?: CadastroTipo, limit?: number)
export async function getPessoa(db: Db, id: string, tipo: CadastroTipo)
export async function listPessoaMovimentacoes(db: Db, id: string, tipo: CadastroTipo)
```

`listPessoaMovimentacoes`: `where eq(pessoaFisicaId, id)` OR PJ; `orderBy desc(dataMovimento)`; no UF filter.

- [ ] **Step 4: Barrel export in `packages/core/src/index.ts`**

Export all public cadastro functions + types.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): conflito resolution and pessoa queries"
```

---

### Task 7: Match evidence CPF_CADASTRO / CNPJ_CADASTRO

**Files:**
- Modify: `packages/core/src/match/rules.ts`
- Modify: `packages/core/src/match/rules.test.ts`
- Modify: `packages/core/src/confidence.ts` (add keys optional, reuse 0.45)

- [ ] **Step 1: Export stub helpers from cadastro constants** — use `isStubNome` in rules OR import `STUB_*` from `cadastro/constants.ts` (remove duplicate `STUB_PF_NOME` in rules.ts).

- [ ] **Step 2: Test — PF with real nome in DB gets CPF_CADASTRO evidence**

- [ ] **Step 3: In `applyDeterministicMatch`, after linking pessoa:**

If `!isStubNome("PF", pessoa.nome)` push `{ tipo: "CPF_CADASTRO", peso: 0.45, detalhe: ... }` instead of/in addition to `CPF_EXATO` when cadastro pre-existed before match (simplest: use `CPF_CADASTRO` whenever linked PF is non-stub).

- [ ] **Step 4: Run `pnpm --filter @spc-up/core test` — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): CPF_CADASTRO evidence when pessoa has real name"
```

---

### Task 8: API routes

**Files:**
- Create: `apps/web/lib/mask-document.ts`
- Create: `apps/web/app/api/pessoas/route.ts`
- Create: `apps/web/app/api/pessoas/[id]/route.ts`
- Create: `apps/web/app/api/pessoas/[id]/movimentacoes/route.ts`
- Create: `apps/web/app/api/pessoas/import/route.ts`
- Create: `apps/web/app/api/pessoas/conflitos/route.ts`
- Create: `apps/web/app/api/pessoas/conflitos/[id]/resolver/route.ts`

- [ ] **Step 1: mask-document**

```typescript
export function maskCpf(cpf: string): string {
  if (cpf.length !== 11) return "***";
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
export function maskCnpj(cnpj: string): string {
  if (cnpj.length !== 14) return "**";
  return `**.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-**`;
}
```

- [ ] **Step 2: GET/POST `/api/pessoas`**

GET: `q`, `tipo` → `searchPessoas`; map response with `documento_mascarado`, `movimentacoes_count` (subquery or secondary count — OK N+1 for v1 with limit 50).

POST: body `{ tipo, documento, nome, uf, exercicio }` → `upsertPessoa`; 409 if `conflict` with `{ conflitoId }`; on success call rematch if inserted/updated.

- [ ] **Step 3: GET `/api/pessoas/[id]?tipo=pf|pj`**

- [ ] **Step 4: GET `/api/pessoas/[id]/movimentacoes?tipo=pf|pj`**

- [ ] **Step 5: POST `/api/pessoas/import`**

`formData`: `file`, `uf`, `exercicio` → buffer → `parseCadastroSpreadsheet` → `importCadastroBatch`.

- [ ] **Step 6: GET `/api/pessoas/conflitos`**, **POST `.../conflitos/[id]/resolver`**

Body: `{ resolucao: "MANTER_NOME" | "ATUALIZAR_NOME" | "IGNORADO" }`.

- [ ] **Step 7: Manual smoke** (dev server)

```bash
pnpm dev
# curl with session cookie or browser after login
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web): API routes for cadastro PF/PJ"
```

---

### Task 9: UI — listagem, cadastro, import

**Files:**
- Create: `apps/web/components/pessoas-table.tsx`
- Create: `apps/web/components/pessoa-form.tsx`
- Create: `apps/web/components/cadastro-import-form.tsx`
- Create: `apps/web/app/pessoas/page.tsx`
- Create: `apps/web/app/pessoas/nova/page.tsx`
- Create: `apps/web/app/pessoas/importar/page.tsx`
- Modify: `apps/web/app/page.tsx` (link)

- [ ] **Step 1: `PessoasTable`** — client component; fetch GET `/api/pessoas?q=`; columns tipo, documento mascarado, nome, qtd movimentações, link `/pessoas/[id]?tipo=pf`.

- [ ] **Step 2: `PessoaForm`** — tipo select, documento, nome, uf, exercicio; POST `/api/pessoas`; show erro 409 com link para `/pessoas/conflitos`.

- [ ] **Step 3: `CadastroImportForm`** — file input + uf/exercicio; POST multipart; show summary counters.

- [ ] **Step 4: Pages** — layout consistente com `/movimentacoes` (max-w-6xl, Card).

- [ ] **Step 5: Dashboard link**

```tsx
<Link href="/pessoas">Pessoas (PF/PJ)</Link>
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): pessoas list, manual cadastro, import UI"
```

---

### Task 10: UI — conflitos e perfil

**Files:**
- Create: `apps/web/components/conflitos-table.tsx`
- Create: `apps/web/components/pessoa-perfil.tsx`
- Create: `apps/web/app/pessoas/conflitos/page.tsx`
- Create: `apps/web/app/pessoas/[id]/page.tsx`

- [ ] **Step 1: `ConflitosTable`** — list GET `/api/pessoas/conflitos`; botões Manter / Atualizar / Ignorar → POST resolver.

- [ ] **Step 2: `PessoaPerfil`** — server or client fetch detail + movimentacoes; tabela histórico com link `/movimentacoes?uf=&exercicio=`; resumo totais.

- [ ] **Step 3: Pages `/pessoas/conflitos` e `/pessoas/[id]`**

- [ ] **Step 4: Visual check** — perfil mostra movimentações de 2 UFs se existirem no banco.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): conflitos queue and pessoa profile with history"
```

---

### Task 11: Verification gate

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
pnpm --filter web lint
```

Expected: all pass (web lint = `tsc --noEmit` if configured).

- [ ] **Step 2: Spec acceptance checklist** (manual)

1. Import 2 PF novos → aparecem em `/pessoas`; mov. pendentes com CPF na descrição vinculadas.
2. Import nome diferente de PF existente → `/pessoas/conflitos` PENDENTE; nome no banco inalterado.
3. Import sobrescreve stub DESCONHECIDO.
4. POST manual conflito → 409.
5. Perfil lista todas movimentações do id.
6. Resolver ATUALIZAR_NOME → rematch.

- [ ] **Step 3: Update README** (opcional one-liner em Documentação table linking new spec).

- [ ] **Step 4: Final commit if README touched**

```bash
git commit -m "docs: link cadastro PF/PJ spec in README"
```

---

## Plan self-review (spec coverage)

| Spec § | Task |
|--------|------|
| §4 Arquitetura core + API + web | Tasks 1–11 |
| §5 `cadastro_conflito` | Task 1 |
| §6 Upsert rules | Task 4 |
| §7 Import planilha | Task 3, 5, 8 |
| §8 Re-match | Task 5 |
| §8.3 CPF_CADASTRO | Task 7 |
| §9 Conflitos UI/API | Task 6, 8, 10 |
| §10 Interface | Task 9–10 |
| §11 APIs | Task 8 |
| §15 Critérios aceite | Task 11 |

No TBD placeholders in tasks.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-26-cadastro-pf-pj.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task, review between tasks  
2. **Inline Execution** — implement task-by-task in this session with checkpoints  

Which approach do you want?
