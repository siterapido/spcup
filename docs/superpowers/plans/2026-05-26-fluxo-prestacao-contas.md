# Fluxo de Prestação de Contas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wizard UF/tipo prestador/exercício + uploads em sessão, kanban por movimentação, match IA Kimi K2.6, cadastro municipal CRUD, export XML + Excel espelho + ZIP.

**Architecture:** Novas tabelas Drizzle (`diretorio_municipal`, `sessao_prestacao`); extensão de `movimentacao`/`arquivo_ingestao`; módulo `packages/core/src/match/ai.ts` chamado após ingestão; UI Next.js em `/prestacao/*` e `/admin/diretorios-municipais`. Export e `canExport` passam a escopo `(cnpjPrestador, exercicio)`.

**Tech Stack:** TypeScript, Drizzle, Neon Postgres, Next.js App Router, OpenRouter (`moonshotai/kimi-k2.6`), Vitest, ExcelJS, Vercel Blob.

**Spec:** [docs/superpowers/specs/2026-05-26-fluxo-prestacao-contas-design.md](../specs/2026-05-26-fluxo-prestacao-contas-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema.ts` | `diretorio_municipal`, `sessao_prestacao`, colunas em `movimentacao`/`arquivo_ingestao` |
| `packages/core/src/prestacao/types.ts` | Enums `TipoPrestador`, `SessaoStatus` |
| `packages/core/src/prestacao/sessao.ts` | `createSessao`, `getSessao`, `resolveCnpjPrestador` |
| `packages/core/src/prestacao/municipal.ts` | CRUD + `importDiretoriosMunicipais` |
| `packages/core/src/ingest/hash.ts` | `computeHashMovimento` com `cnpjPrestador` |
| `packages/core/src/ingest/pipeline.ts` | Params de sessão/prestador; pós-ingest chama IA |
| `packages/core/src/match/ai.ts` | `evaluateMovimentacaoWithAi` (Kimi JSON schema) |
| `packages/core/src/match/apply-ai.ts` | Persiste score, evidências, pessoa, status |
| `packages/core/src/export/guard.ts` | `canExportByPrestador(cnpj, exercicio)` |
| `packages/core/src/export/excel-mirror.ts` | Gera `.xlsx` espelho XSD |
| `packages/core/src/export/zip-pack.ts` | ZIP XML + Excel + pendências |
| `apps/web/app/prestacao/nova/page.tsx` | Wizard |
| `apps/web/app/prestacao/[sessaoId]/kanban/page.tsx` | Kanban |
| `apps/web/components/prestacao/*` | Wizard steps, kanban card, column |
| `apps/web/app/api/prestacao/**` | APIs sessão/upload/lista |
| `apps/web/app/admin/diretorios-municipais/**` | Admin CRUD |

---

### Task 1: Schema — municipal + sessão + movimentação

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/index.ts` (exports de tipos se necessário)

- [ ] **Step 1: Add `diretorio_municipal` and `sessao_prestacao`**

```typescript
export const TIPO_PRESTADOR = { ESTADUAL: "ESTADUAL", MUNICIPAL: "MUNICIPAL" } as const;
export const SESSAO_STATUS = {
  ABERTA: "ABERTA",
  EM_PROCESSAMENTO: "EM_PROCESSAMENTO",
  ENCERRADA: "ENCERRADA",
} as const;

export const diretorioMunicipal = pgTable(
  "diretorio_municipal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uf: varchar("uf", { length: 2 }).notNull(),
    codigoIbge: varchar("codigo_ibge", { length: 7 }),
    nomeMunicipio: varchar("nome_municipio", { length: 255 }).notNull(),
    cnpjPrestador: varchar("cnpj_prestador", { length: 14 }).notNull().unique(),
    ativo: boolean("ativo").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ix_diretorio_municipal_uf_ativo").on(t.uf, t.ativo)],
);

export const sessaoPrestacao = pgTable("sessao_prestacao", {
  id: uuid("id").primaryKey().defaultRandom(),
  uf: varchar("uf", { length: 2 }).notNull(),
  tipoPrestador: varchar("tipo_prestador", { length: 10 }).notNull(),
  diretorioEstadualId: uuid("diretorio_estadual_id").references(() => diretorioEstadual.id),
  diretorioMunicipalId: uuid("diretorio_municipal_id").references(() => diretorioMunicipal.id),
  exercicio: integer("exercicio").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("ABERTA"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Extend `movimentacao` and `arquivo_ingestao`**

Add to `movimentacao`:
- `cnpjPrestador varchar(14) not null` (backfill from diretório em migration SQL)
- `tipoPrestador varchar(10) not null`
- `diretorioMunicipalId uuid nullable`
- `sessaoPrestacaoId uuid nullable` → FK `sessao_prestacao`

Replace unique index `uq_mov_uf_exercicio_hash` with `uniqueIndex("uq_mov_prestador_exercicio_hash").on(cnpjPrestador, exercicio, hashMovimento)`.

Add to `arquivo_ingestao`: `sessaoPrestacaoId uuid nullable`.

- [ ] **Step 3: Generate migration + backfill**

Run:

```bash
pnpm db:generate
```

Edit generated SQL to backfill `movimentacao.cnpj_prestador` from `diretorio_estadual` via `uf` join before `NOT NULL` constraint.

Run:

```bash
pnpm db:migrate
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): sessao prestacao, diretorio municipal, prestador scope on movimentacao"
```

---

### Task 2: Hash dedup com CNPJ prestador (TDD)

**Files:**
- Modify: `packages/core/src/ingest/hash.ts`
- Modify: `packages/core/src/ingest/ofx.ts` (e `excel.ts` se chamar hash)
- Modify: `packages/core/src/ingest/ofx.test.ts`
- Test: `packages/core/src/ingest/hash.test.ts` (create)

- [ ] **Step 1: Failing test**

`packages/core/src/ingest/hash.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeHashMovimento } from "./hash";

const row = {
  dataMovimento: new Date("2025-03-01"),
  valor: "100.00",
  descricaoRaw: "PIX",
  direcao: "ENTRADA" as const,
  nrExtratoBancario: "1",
};

describe("computeHashMovimento", () => {
  it("differs when cnpj prestador differs", () => {
    const a = computeHashMovimento("14679407000100", 2025, row);
    const b = computeHashMovimento("12345678000199", 2025, row);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/ingest/hash.test.ts -v
```

- [ ] **Step 3: Change signature**

```typescript
export function computeHashMovimento(
  cnpjPrestador: string,
  exercicio: number,
  row: ParsedTransactionRow,
): string {
  const payload = [
    cnpjPrestador,
    String(exercicio),
    row.dataMovimento.toISOString().slice(0, 10),
    row.valor,
    row.descricaoRaw,
    row.direcao,
    row.nrExtratoBancario ?? "",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}
```

Update all call sites (`ofx.ts`, `pdf.ts`, tests) to pass `cnpjPrestador` instead of `uf`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run packages/core/src/ingest -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/
git commit -m "feat(core): include cnpj prestador in movimentacao hash"
```

---

### Task 3: Prestacao session + resolve prestador (TDD)

**Files:**
- Create: `packages/core/src/prestacao/types.ts`
- Create: `packages/core/src/prestacao/sessao.ts`
- Create: `packages/core/src/prestacao/sessao.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: `resolveCnpjPrestador` test**

```typescript
import { describe, expect, it } from "vitest";
import { resolveCnpjPrestador } from "./sessao";

describe("resolveCnpjPrestador", () => {
  it("returns estadual cnpj", () => {
    expect(
      resolveCnpjPrestador({
        tipoPrestador: "ESTADUAL",
        diretorioEstadual: { cnpjPrestador: "11111111000111" },
        diretorioMunicipal: null,
      }),
    ).toBe("11111111000111");
  });
});
```

- [ ] **Step 2: Implement `createSessao`**

Validar: se `MUNICIPAL`, exige `diretorioMunicipalId` ativo na mesma `uf`; se `ESTADUAL`, exige `diretorioEstadual` da UF.

```typescript
export async function createSessao(
  db: Db,
  input: {
    uf: string;
    tipoPrestador: "ESTADUAL" | "MUNICIPAL";
    diretorioMunicipalId?: string;
    exercicio: number;
  },
): Promise<SessaoPrestacao> { /* insert sessao_prestacao */ }
```

- [ ] **Step 3: Run tests**

```bash
pnpm exec vitest run packages/core/src/prestacao -v
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/prestacao/
git commit -m "feat(core): sessao prestacao create and cnpj resolver"
```

---

### Task 4: Cadastro municipal — CRUD + import (TDD)

**Files:**
- Create: `packages/core/src/prestacao/municipal.ts`
- Create: `packages/core/src/prestacao/municipal.test.ts`
- Create: `packages/core/src/prestacao/parse-municipal.ts`

- [ ] **Step 1: Test import row validation**

Reject duplicate `cnpj_prestador`, normalize CNPJ com `normalizeCnpj` existente.

- [ ] **Step 2: Implement**

- `listDiretoriosMunicipais(db, uf, { q?, ativo? })`
- `upsertDiretorioMunicipal(db, dto)`
- `importDiretoriosMunicipais(db, rows)` → `{ criados, atualizados, erros[] }`

Planilha colunas: `uf`, `codigo_ibge`, `nome_municipio`, `cnpj_prestador`.

- [ ] **Step 3: Run tests + commit**

```bash
pnpm exec vitest run packages/core/src/prestacao/municipal.test.ts -v
git commit -m "feat(core): diretorio municipal crud and import"
```

---

### Task 5: Kimi AI match module (TDD)

**Files:**
- Create: `packages/core/src/match/ai.ts`
- Create: `packages/core/src/match/apply-ai.ts`
- Create: `packages/core/src/match/ai.test.ts`
- Modify: `packages/core/src/ai/openrouter.ts` (extrair `chatStructured` genérico)
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Env default**

`apps/web/.env.example`:

```
OPENROUTER_MODEL=moonshotai/kimi-k2.6
```

- [ ] **Step 2: Failing test with mocked fetch**

```typescript
it("maps AI response to evidencias and confianca", async () => {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            mesmo_evento: true,
            confianca: 0.91,
            justificativa: "CPF e valor conferem; data D+1 após feriado.",
            pessoa_tipo: "PF",
            pessoa_documento: "12345678901",
            campos_faltantes: ["fonte_recurso"],
            evidencias: [{ tipo: "IA_DATA_TOLERANCIA", detalhe: "Carnaval" }],
          }),
        },
      }],
    }),
  });
  const out = await evaluateMovimentacaoWithAi(db, movimentacaoId, { fetch: mockFetch });
  expect(out.confianca).toBe(0.91);
  expect(out.camposFaltantes).toContain("fonte_recurso");
});
```

- [ ] **Step 3: Implement `evaluateMovimentacaoWithAi`**

- Carrega movimentação + cadastro candidatos (CPF/CNPJ extraído + mesmo documento na base).
- POST OpenRouter com `response_format.json_schema` (campos do spec §5.2).
- Não chama API se `OPENROUTER_API_KEY` ausente em testes.

- [ ] **Step 4: Implement `applyAiMatchToMovimentacao`**

- Limpa evidências `IA_*` anteriores.
- Insere `match_evidencia` para cada evidência + `IA_JUSTIFICATIVA`.
- Atualiza `confianca_global`, `pessoa_fisica_id`/`pessoa_juridica_id` se documento válido.
- `bloqueio_export` se `DOCUMENTO_INVALIDO` ou lacunas XSD críticas (`evaluateMovimentacao` existente).
- Status → `PENDENTE_REVISAO` se lacunas ou confiança < 0.85; senão `PENDENTE_REVISAO` também (piloto exige humano antes de CONFIRMADO).

- [ ] **Step 5: Run tests + commit**

```bash
pnpm exec vitest run packages/core/src/match -v
git commit -m "feat(core): kimi AI match with structured evidencias"
```

---

### Task 6: Ingest pipeline — sessão + IA pós-ingest

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/ingest/ofx.ts` (`persistTransactions` recebe `cnpjPrestador`, `tipoPrestador`, `sessaoId`, `diretorioMunicipalId`)

- [ ] **Step 1: Extend `IngestBufferParams`**

```typescript
export interface IngestBufferParams {
  diretorioId: string;
  uf: string;
  exercicio: number;
  filename: string;
  buffer: Buffer;
  caminhoStorage: string;
  cnpjPrestador: string;
  tipoPrestador: "ESTADUAL" | "MUNICIPAL";
  sessaoPrestacaoId?: string;
  diretorioMunicipalId?: string;
  confiancaLimiteAlta?: number;
  skipAi?: boolean;
}
```

- [ ] **Step 2: After each movimentação criada**

Replace `applyDeterministicMatch` with:

```typescript
await applyAiMatchToMovimentacao(db, mov.id);
```

Keep deterministic doc extract inside `applyAiMatch` input building, or run extract candidates before AI call.

- [ ] **Step 3: Set `arquivo_ingestao.sessao_prestacao_id` on insert**

- [ ] **Step 4: Integration test**

Use fixture OFX + mock fetch; assert movimentação has `confianca_global > 0` and `match_evidencia` tipo `IA_JUSTIFICATIVA`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): ingest tied to sessao and AI match pipeline"
```

---

### Task 7: Export guard e run por prestador

**Files:**
- Modify: `packages/core/src/export/guard.ts`
- Modify: `packages/core/src/export/guard.test.ts`
- Modify: `packages/core/src/export/run.ts`
- Modify: `apps/web/app/api/export/[uf]/[exercicio]/route.ts` → nova rota ou query `prestador`

- [ ] **Step 1: Add `canExportByPrestador(db, cnpjPrestador, exercicio)`**

Filter `movimentacao` por `cnpjPrestador` + `exercicio` (não só `uf`).

Deprecate wrapper `canExport(db, uf, exercicio)` para estadual apenas (chama resolver CNPJ da UF).

- [ ] **Step 2: `runExport` aceita `cnpjPrestador`**

`nrCnpjPrestador` no XML = argumento, não inferido só por UF.

- [ ] **Step 3: Tests + commit**

```bash
pnpm exec vitest run packages/core/src/export/guard.test.ts -v
git commit -m "feat(core): export scope by cnpj prestador"
```

---

### Task 8: Excel espelho + ZIP pacote

**Files:**
- Create: `packages/core/src/export/excel-mirror.ts`
- Create: `packages/core/src/export/zip-pack.ts`
- Create: `packages/core/src/export/excel-mirror.test.ts`
- Create: `packages/spca/templates/.gitkeep` (placeholder até templates TSE)

- [ ] **Step 1: `buildExcelMirror(db, cnpjPrestador, exercicio)`**

Abas `Origem`, `Aplicacao`, `Doacao` com colunas alinhadas a `movimentacao` + `movimentacao_spca` (somente CONFIRMADO/EXPORTADO).

- [ ] **Step 2: `buildExportZip`**

Inclui XMLs de `runExport`, `pendencias.csv`, `espelho.xlsx`; se existir template em `packages/spca/templates/origem.xlsx`, copiar preenchido (fase mínima: só espelho + XML).

- [ ] **Step 3: Test snapshot header row**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): excel mirror and export zip bundle"
```

---

### Task 9: APIs — sessão, upload, kanban data

**Files:**
- Create: `apps/web/app/api/prestacao/sessoes/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/movimentacoes/route.ts`
- Create: `apps/web/app/api/movimentacoes/[id]/status/route.ts`
- Modify: `apps/web/app/api/movimentacoes/confirm/route.ts`

- [ ] **Step 1: POST `/api/prestacao/sessoes`**

Body: `{ uf, tipoPrestador, diretorioMunicipalId?, exercicio }` → `createSessao`.

- [ ] **Step 2: POST upload**

Multipart múltiplos arquivos; para cada um: Blob + `ingestFileBuffer` com contexto da sessão; atualiza sessão `EM_PROCESSAMENTO` → `ABERTA` ao fim.

`maxDuration = 300` (já usado em upload atual).

- [ ] **Step 3: GET movimentacoes**

Retorno agrupável:

```typescript
{
  sessao: { ... },
  arquivos: [{ id, nomeArquivo, status, movimentacoes: KanbanCard[] }]
}
```

`KanbanCard`: id, valor, data, direcao, status, confiancaGlobal, bloqueioExport, lacunas[], justificativaIa, pessoaResumo.

- [ ] **Step 4: PATCH status**

Validar transições (não CONFIRMADO se `bloqueioExport`).

- [ ] **Step 5: Manual smoke**

```bash
pnpm dev
# curl POST sessao, upload sample.xlsx, GET movimentacoes
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): prestacao sessao and upload APIs"
```

---

### Task 10: Admin municipal APIs + UI

**Files:**
- Create: `apps/web/app/api/admin/diretorios-municipais/route.ts`
- Create: `apps/web/app/api/admin/diretorios-municipais/import/route.ts`
- Create: `apps/web/app/admin/diretorios-municipais/page.tsx`
- Create: `apps/web/components/admin/municipal-form.tsx`

- [ ] **Step 1: GET/POST/PATCH handlers** (auth `requireSession`)

- [ ] **Step 2: Página admin**

Tabela com filtro UF, modal criar/editar, link importar planilha (reutilizar padrão `cadastro-import-form.tsx`).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): admin diretorios municipais"
```

---

### Task 11: Wizard `/prestacao/nova`

**Files:**
- Create: `apps/web/app/prestacao/nova/page.tsx`
- Create: `apps/web/components/prestacao/wizard.tsx`
- Modify: `apps/web/components/app-nav.tsx`

- [ ] **Step 1: Wizard client component**

Steps 1–5 conforme spec; step 3 municipal usa `GET /api/admin/diretorios-municipais?uf=XX&ativo=true`.

- [ ] **Step 2: Submit**

POST sessão → loop upload arquivos → `router.push(/prestacao/${id}/kanban)`.

- [ ] **Step 3: Nav link "Nova prestação"**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): prestacao wizard"
```

---

### Task 12: Kanban UI

**Files:**
- Create: `apps/web/app/prestacao/[sessaoId]/kanban/page.tsx`
- Create: `apps/web/components/prestacao/kanban-board.tsx`
- Create: `apps/web/components/prestacao/kanban-card.tsx`
- Create: `apps/web/components/prestacao/movimentacao-drawer.tsx`

- [ ] **Step 1: Board com 4 colunas + Rejeitado**

Usar `@dnd-kit/core` se já no projeto; senão HTML5 DnD simples.

- [ ] **Step 2: Card UI**

Badges confiança (success/warn/danger), chips lacunas, expand justificativa IA.

- [ ] **Step 3: Agrupamento por arquivo** (`<details>` ou accordion)

- [ ] **Step 4: Toolbar**

Confirmar selecionados (POST confirm), Export ZIP (nova rota `GET /api/prestacao/sessoes/[id]/export`), pendências CSV.

- [ ] **Step 5: Drawer revisão**

Editar pessoa/campos SPCA; salvar PATCH movimentação existente ou nova rota `PATCH /api/movimentacoes/[id]`.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): prestacao kanban board"
```

---

### Task 13: Dashboard + export route + spec status

**Files:**
- Modify: `apps/web/app/page.tsx`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/export/route.ts`

- [ ] **Step 1: Dashboard**

CTA "Nova prestação", lista últimas 10 sessões (`GET /api/prestacao/sessoes?limit=10` — adicionar list na route).

- [ ] **Step 2: Export ZIP endpoint**

Chama `buildExportZip`; retorna `application/zip`.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): dashboard sessoes and export zip"
```

---

### Task 14: Verificação final

- [ ] **Step 1: Run monorepo tests**

```bash
pnpm test
```

- [ ] **Step 2: Build web**

```bash
pnpm build
```

- [ ] **Step 3: Checklist manual (piloto)**

1. Criar diretório municipal SP via admin  
2. Nova prestação municipal → upload `packages/core/fixtures/sample.xlsx`  
3. Kanban mostra cards em Revisão com confiança e lacunas  
4. Confirmar linha → export ZIP com 3 XML + espelho.xlsx  
5. Repetir fluxo estadual UF com diretório existente  

---

## Spec coverage (self-review)

| Spec § | Task |
|--------|------|
| §3 Sessão prestador | 1, 3, 6, 9 |
| §4 Modelo dados | 1, 2 |
| §5 Pipeline IA Kimi | 5, 6 |
| §6 Wizard/Kanban UX | 11, 12 |
| §6.3 Admin municipal | 4, 10 |
| §7 Export D | 7, 8, 13 |
| §8 APIs | 9, 10, 13 |
| §13 Migração compat | 1, 7 (wrapper uf) |
| §14 Env Kimi | 5 |

**Fora de escopo** (spec §12): não incluído — correto.

**Ambiguity resolved:** dedup por `(cnpjPrestador, exercicio, hash)` — Task 1–2.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-fluxo-prestacao-contas.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans, batched checkpoints  

Which approach do you want?
