# Plataforma operacional — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro de prestadores estaduais (27 UFs) e evolução municipal, kanban de revisão com drawer e vínculo PF/PJ, navegação integrada e hub legado recolhido.

**Architecture:** Lógica em `@spc-up/core` (`prestacao/estadual.ts`, `prestacao/movimentacao-review.ts`, extensões em `municipal.ts` e `confirm.ts`); APIs Next em `apps/web/app/api/**`; UI com subnav contextual, admin estadual, drawer no kanban. Sem migration de schema (tabelas já existem).

**Tech Stack:** TypeScript, Drizzle, Neon Postgres, Next.js App Router, Vitest, Zod, Tailwind (tokens UP em `globals.css`).

**Spec:** [docs/superpowers/specs/2026-05-26-plataforma-operacional-fase1-design.md](../specs/2026-05-26-plataforma-operacional-fase1-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/prestacao/constants.ts` | `VALID_UFS`, `isPlaceholderCnpjPrestador` |
| `packages/core/src/prestacao/estadual.ts` | List/upsert/import diretórios estaduais |
| `packages/core/src/prestacao/estadual.test.ts` | Unit tests estadual |
| `packages/core/src/prestacao/municipal.ts` | `updateDiretorioMunicipalById` |
| `packages/core/src/prestacao/movimentacao-review.ts` | Detalhe, assign pessoa, reprocessar IA |
| `packages/core/src/prestacao/movimentacao-review.test.ts` | Unit tests review |
| `packages/core/src/confirm.ts` | Bloquear confirm se `bloqueio_export` |
| `packages/core/src/index.ts` | Re-exports |
| `apps/web/app/api/admin/diretorios-estaduais/route.ts` | GET lista |
| `apps/web/app/api/admin/diretorios-estaduais/[id]/route.ts` | PATCH |
| `apps/web/app/api/admin/diretorios-estaduais/import/route.ts` | POST import (opcional: ou multipart no route.ts) |
| `apps/web/app/api/admin/diretorios-municipais/[id]/route.ts` | PATCH municipal |
| `apps/web/app/api/movimentacoes/[id]/route.ts` | GET detalhe, PATCH pessoa |
| `apps/web/app/api/movimentacoes/[id]/reprocessar-ia/route.ts` | POST IA |
| `apps/web/app/admin/diretorios-estaduais/page.tsx` | UI 27 UFs |
| `apps/web/app/admin/diretorios-municipais/page.tsx` | Import UI + edit + IBGE |
| `apps/web/components/prestacao/review-drawer.tsx` | Drawer revisão |
| `apps/web/components/prestacao/kanban-board.tsx` | 5 colunas + agrupamento + drawer |
| `apps/web/components/layout/operacao-subnav.tsx` | Subnav `/prestacao/*`, `/admin/*` |
| `apps/web/components/app-nav.tsx` | Dropdown Prestação + Admin |
| `apps/web/app/layout.tsx` | Montar `OperacaoSubnav` |
| `apps/web/app/page.tsx` | Hub + legado em `<details>` |
| `apps/web/components/prestacao/wizard.tsx` | Aviso CNPJ placeholder estadual |

---

### Task 1: Constantes UF + helper placeholder CNPJ

**Files:**
- Create: `packages/core/src/prestacao/constants.ts`
- Create: `packages/core/src/prestacao/constants.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/core/src/prestacao/constants.test.ts
import { describe, expect, it } from "vitest";
import { isPlaceholderCnpjPrestador, isValidUf } from "./constants";

describe("prestacao/constants", () => {
  it("isValidUf accepts SP rejects XX", () => {
    expect(isValidUf("SP")).toBe(true);
    expect(isValidUf("XX")).toBe(false);
  });

  it("isPlaceholderCnpjPrestador detects seed prefix", () => {
    expect(isPlaceholderCnpjPrestador("00000000000124")).toBe(true);
    expect(isPlaceholderCnpjPrestador("12345678000190")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && pnpm exec vitest run src/prestacao/constants.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/prestacao/constants.ts
export const VALID_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type UfSigla = (typeof VALID_UFS)[number];

export function isValidUf(uf: string): boolean {
  return VALID_UFS.includes(uf.toUpperCase() as UfSigla);
}

/** Seed script uses 00000000000100–126 — treat as not production-ready. */
export function isPlaceholderCnpjPrestador(cnpj: string): boolean {
  return /^00000000000/.test(cnpj);
}
```

Export from `packages/core/src/index.ts`.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/prestacao/constants.ts packages/core/src/prestacao/constants.test.ts packages/core/src/index.ts
git commit -m "feat(core): add UF constants and placeholder CNPJ helper"
```

---

### Task 2: Módulo `estadual.ts` (TDD)

**Files:**
- Create: `packages/core/src/prestacao/estadual.ts`
- Create: `packages/core/src/prestacao/estadual.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests** (use in-memory DB mock or drizzle mock pattern from `sessao.test.ts`)

Test cases:
- `upsertDiretorioEstadualByUf` atualiza CNPJ/nome para UF existente
- rejeita UF inválida
- `importDiretoriosEstaduais` acumula `erros` sem abortar

- [ ] **Step 2: Implement `estadual.ts`**

```typescript
import { diretorioEstadual, type Db, type DiretorioEstadual } from "@spc-up/db";
import { asc, eq } from "drizzle-orm";
import { normalizeCnpj } from "../normalize";
import { isValidUf } from "./constants";

export interface DiretorioEstadualInput {
  uf: string;
  cnpjPrestador: string;
  nome: string;
  ativo?: boolean;
}

export interface ImportEstadualRow {
  uf: string;
  cnpj_prestador: string;
  nome: string;
}

export async function listDiretoriosEstaduais(
  db: Db,
  options?: { ativoOnly?: boolean },
): Promise<DiretorioEstadual[]> {
  const rows = await db.select().from(diretorioEstadual).orderBy(asc(diretorioEstadual.uf));
  if (options?.ativoOnly === false) return rows;
  return rows.filter((r) => r.ativo);
}

export async function getDiretorioEstadualByUf(
  db: Db,
  uf: string,
): Promise<DiretorioEstadual | undefined> {
  return db.query.diretorioEstadual.findFirst({
    where: eq(diretorioEstadual.uf, uf.toUpperCase()),
  });
}

export async function upsertDiretorioEstadualByUf(
  db: Db,
  input: DiretorioEstadualInput,
): Promise<DiretorioEstadual> {
  const uf = input.uf.toUpperCase();
  if (!isValidUf(uf)) throw new Error(`UF inválida: ${uf}`);
  const cnpj = normalizeCnpj(input.cnpjPrestador);

  const existing = await getDiretorioEstadualByUf(db, uf);
  if (existing) {
    const [updated] = await db
      .update(diretorioEstadual)
      .set({
        cnpjPrestador: cnpj,
        nome: input.nome,
        ativo: input.ativo ?? true,
        updatedAt: new Date(),
      })
      .where(eq(diretorioEstadual.id, existing.id))
      .returning();
    if (!updated) throw new Error("Falha ao atualizar diretório estadual");
    return updated;
  }

  const [created] = await db
    .insert(diretorioEstadual)
    .values({ uf, cnpjPrestador: cnpj, nome: input.nome, ativo: input.ativo ?? true })
    .returning();
  if (!created) throw new Error("Falha ao criar diretório estadual");
  return created;
}

export async function updateDiretorioEstadualById(
  db: Db,
  id: string,
  input: Partial<DiretorioEstadualInput>,
): Promise<DiretorioEstadual> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.cnpjPrestador != null) patch.cnpjPrestador = normalizeCnpj(input.cnpjPrestador);
  if (input.nome != null) patch.nome = input.nome;
  if (input.ativo != null) patch.ativo = input.ativo;
  const [updated] = await db
    .update(diretorioEstadual)
    .set(patch)
    .where(eq(diretorioEstadual.id, id))
    .returning();
  if (!updated) throw new Error("Diretório estadual não encontrado");
  return updated;
}

export async function importDiretoriosEstaduais(
  db: Db,
  rows: ImportEstadualRow[],
): Promise<{ atualizados: number; erros: Array<{ linha: number; motivo: string }> }> {
  let atualizados = 0;
  const erros: Array<{ linha: number; motivo: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await upsertDiretorioEstadualByUf(db, {
        uf: rows[i]!.uf,
        cnpjPrestador: rows[i]!.cnpj_prestador,
        nome: rows[i]!.nome,
      });
      atualizados += 1;
    } catch (error) {
      erros.push({
        linha: i + 1,
        motivo: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { atualizados, erros };
}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd packages/core && pnpm exec vitest run src/prestacao/estadual.test.ts
git commit -m "feat(core): diretorio estadual list upsert import"
```

---

### Task 3: APIs admin estadual

**Files:**
- Create: `apps/web/app/api/admin/diretorios-estaduais/route.ts`
- Create: `apps/web/app/api/admin/diretorios-estaduais/[id]/route.ts`

- [ ] **Step 1: GET `/api/admin/diretorios-estaduais`**

Retorna `{ items: [...] }` com campos `id, uf, nome, cnpjPrestador, ativo, placeholder: isPlaceholderCnpjPrestador(cnpj)`.

Query `?ativoOnly=false` opcional.

- [ ] **Step 2: PATCH `/api/admin/diretorios-estaduais/[id]`**

Body Zod: `{ cnpjPrestador?, nome?, ativo? }` → `updateDiretorioEstadualById`.

- [ ] **Step 3: POST import no mesmo `route.ts` (multipart)**

Espelhar parsing CSV de `diretorios-municipais/route.ts` com colunas `uf`, `cnpj`, `nome`.

Chamar `importDiretoriosEstaduais`.

- [ ] **Step 4: Manual smoke**

```bash
# com sessão autenticada via browser ou curl com cookie
curl -s http://localhost:3000/api/admin/diretorios-estaduais | head
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): admin diretorios estaduais CRUD and import"
```

---

### Task 4: UI `/admin/diretorios-estaduais`

**Files:**
- Create: `apps/web/app/admin/diretorios-estaduais/page.tsx`

- [ ] **Step 1: Página client com tabela 27 linhas**

Colunas: UF, Nome, CNPJ (`maskCnpj`), Status (ativo), badge “CNPJ pendente” se `placeholder`.

- [ ] **Step 2: Modal/inline edit**

PATCH ao salvar; validação erro do servidor exibida.

- [ ] **Step 3: Import CSV**

`<input type="file" accept=".csv,.txt" />` → POST multipart → tabela `erros[]`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): admin UI for state directorates"
```

---

### Task 5: Municipal — `updateById` + PATCH API + UI

**Files:**
- Modify: `packages/core/src/prestacao/municipal.ts`
- Create: `apps/web/app/api/admin/diretorios-municipais/[id]/route.ts`
- Modify: `apps/web/app/admin/diretorios-municipais/page.tsx`

- [ ] **Step 1: Add `updateDiretorioMunicipalById`**

```typescript
export async function updateDiretorioMunicipalById(
  db: Db,
  id: string,
  input: Partial<DiretorioMunicipalInput>,
): Promise<DiretorioMunicipal> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.nomeMunicipio != null) patch.nomeMunicipio = input.nomeMunicipio;
  if (input.codigoIbge !== undefined) patch.codigoIbge = input.codigoIbge;
  if (input.cnpjPrestador != null) patch.cnpjPrestador = normalizeCnpj(input.cnpjPrestador);
  if (input.ativo != null) patch.ativo = input.ativo;
  const [updated] = await db
    .update(diretorioMunicipal)
    .set(patch)
    .where(eq(diretorioMunicipal.id, id))
    .returning();
  if (!updated) throw new Error("Diretório municipal não encontrado");
  return updated;
}
```

- [ ] **Step 2: PATCH route** com Zod body.

- [ ] **Step 3: UI municipal**

- Campo `codigoIbge` no form criar
- Botão “Importar planilha” (POST multipart já existe no route)
- Coluna ações: Editar (modal), Desativar (`ativo: false`)
- `maskCnpj` na lista

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: municipal directorate update import UI"
```

---

### Task 6: `movimentacao-review.ts` + confirm guard (TDD)

**Files:**
- Create: `packages/core/src/prestacao/movimentacao-review.ts`
- Create: `packages/core/src/prestacao/movimentacao-review.test.ts`
- Modify: `packages/core/src/confirm.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Test `assignPessoaToMovimentacao`**

- Vincula PF limpa `pessoa_juridica_id`
- Chama `applyDeterministicMatch` após update

- [ ] **Step 2: Implement review module**

```typescript
export async function getMovimentacaoDetalhe(db: Db, id: string) { /* join pessoa, spca, evidencias, arquivo */ }

export async function assignPessoaToMovimentacao(
  db: Db,
  id: string,
  pessoa: { pessoaFisicaId: string } | { pessoaJuridicaId: string } | { limparPessoa: true },
): Promise<void> { /* update FKs + applyDeterministicMatch */ }

export async function reprocessarIaMovimentacao(db: Db, id: string) {
  return applyAiMatchToMovimentacao(db, id);
}
```

`getMovimentacaoDetalhe` retorna shape usado pelo drawer (incluir `lacunas` via mesma lógica de `kanban.ts`).

- [ ] **Step 3: Harden `confirmMovimentacoes`**

Após `evaluateMovimentacao(like)`, se `like.bloqueio_export` → **não** atualizar status; adicionar id em `blocked: string[]` no resultado:

```typescript
export interface ConfirmResult {
  confirmed: number;
  total: number;
  notFound: string[];
  blocked: string[]; // novo
}
```

Atualizar `apps/web/app/api/movimentacoes/confirm/route.ts` para retornar `blocked` na resposta JSON.

- [ ] **Step 4: Run tests**

```bash
cd packages/core && pnpm exec vitest run src/prestacao/movimentacao-review.test.ts src/confirm.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): movimentacao review assign pessoa and confirm blocked guard"
```

---

### Task 7: APIs movimentação (detalhe, PATCH, reprocessar IA)

**Files:**
- Create: `apps/web/app/api/movimentacoes/[id]/route.ts`
- Create: `apps/web/app/api/movimentacoes/[id]/reprocessar-ia/route.ts`

- [ ] **Step 1: GET** → `getMovimentacaoDetalhe`

- [ ] **Step 2: PATCH** body Zod:

```typescript
const bodySchema = z.union([
  z.object({ pessoaFisicaId: z.string().uuid() }),
  z.object({ pessoaJuridicaId: z.string().uuid() }),
  z.object({ limparPessoa: z.literal(true) }),
]);
```

- [ ] **Step 3: POST reprocessar-ia**

Try/catch OpenRouter; 503 se indisponível.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(api): movimentacao detail patch pessoa reprocess IA"
```

---

### Task 8: Kanban — drawer + 5 colunas + agrupamento por arquivo

**Files:**
- Create: `apps/web/components/prestacao/review-drawer.tsx`
- Modify: `apps/web/components/prestacao/kanban-board.tsx`
- Modify: `apps/web/app/api/pessoas/route.ts` (GET search `?q=` se ainda não existir)

- [ ] **Step 1: `review-drawer.tsx`**

Props: `movimentacaoId`, `open`, `onClose`, `onUpdated`.

Fetch GET `/api/movimentacoes/[id]`.

UI: campos do spec §6.3; busca pessoa (GET `/api/pessoas?q=`); botões Confirmar / Rejeitar / Reprocessar IA; link `/pessoas/nova?retorno=...`.

- [ ] **Step 2: Refatorar `kanban-board.tsx`**

- Adicionar coluna `REJEITADO` (grid `lg:grid-cols-5` ou scroll horizontal)
- Por coluna: iterar `data.arquivos` → render cabeçalho arquivo → cards daquele status
- Remover `<Card>Agrupamento por arquivo</Card>` do rodapé
- Click no card abre drawer

- [ ] **Step 3: Tratar `blocked` no confirm lote**

Exibir mensagem quando API retornar `blocked.length > 0`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): kanban review drawer five columns file grouping"
```

---

### Task 9: Navegação integrada + hub dashboard

**Files:**
- Create: `apps/web/components/layout/operacao-subnav.tsx`
- Modify: `apps/web/components/app-nav.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: `app-nav.tsx`**

Links dropdown (client):
- Prestação → `/prestacao/nova`
- Admin → `/admin/diretorios-estaduais`, `/admin/diretorios-municipais`

Use `<details>`/`<summary>` ou estado simples; estilo UP (sem ícones decorativos).

- [ ] **Step 2: `operacao-subnav.tsx`**

`usePathname()`; se `pathname.startsWith('/prestacao')` → links Nova + breadcrumb; se `/admin` → Estaduais | Municipais.

- [ ] **Step 3: `layout.tsx`**

Renderizar `<OperacaoSubnav />` abaixo de `AppHeader` quando autenticado.

- [ ] **Step 4: `page.tsx`**

Mover filtro/upload/export para:

```tsx
<details className="mt-8 rounded-md border border-border-default p-4">
  <summary className="cursor-pointer text-sm font-medium">
    Operações por UF (legado)
  </summary>
  {/* conteúdo atual de filtro, upload, export */}
</details>
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): integrated nav subnav and collapsed legacy hub"
```

---

### Task 10: Wizard — aviso CNPJ estadual placeholder

**Files:**
- Modify: `apps/web/components/prestacao/wizard.tsx`

- [ ] **Step 1: Ao selecionar UF + ESTADUAL**

Fetch `GET /api/admin/diretorios-estaduais` (ou endpoint leve `?uf=SP`) e se `placeholder`, mostrar alerta amarelo com link `/admin/diretorios-estaduais`.

- [ ] **Step 2: Municipal vazio**

Manter mensagem + link municipal (já parcialmente existe via lista vazia).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): wizard warns placeholder state CNPJ"
```

---

### Task 11: Verificação final

- [ ] **Step 1: Unit tests core**

```bash
pnpm --filter @spc-up/core test
```

Expected: all pass.

- [ ] **Step 2: Lint/typecheck web**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Manual E2E checklist**

1. Importar CSV estadual com CNPJ real para SP
2. Nova prestação estadual SP → upload fixture → kanban
3. Abrir drawer → vincular PF → confirmar
4. Export pacote quando `exportavel`
5. Desativar município teste; wizard não lista

- [ ] **Step 4: Commit any fixes**

```bash
git commit -m "chore: phase1 verification fixes"
```

---

## Spec coverage checklist

| Spec § | Task |
|--------|------|
| 5.1 Estadual híbrido | 1–4 |
| 5.2 Municipal evolução | 5 |
| 5.3 APIs admin | 3, 5 |
| 5.4 Wizard impacto | 10 |
| 6 Kanban revisão | 6–8 |
| 7 Navegação | 9 |
| 8 UI guidelines | 4, 8, 9 (mask, badges, sem hero metrics) |
| 9 Erros | 2, 6, 7 (normalizeCnpj throws) |
| 11 Testes | 1, 2, 6, 11 |

**Fase 2** (dashboard stats, PF/PJ polish): fora deste plano.

---

## Execution handoff

Plan saved. Choose:

1. **Subagent-Driven** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, `executing-plans`, batched checkpoints

Which approach?
