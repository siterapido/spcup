# Consolidação multi-extrato + cadastro UF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opção no wizard para consolidar extratos (PIX + completo), cruzar com cadastro, listar eventos com confiança e referências, aprovar merge antes do kanban.

**Architecture:** Tabelas `consolidacao_*` + coluna `movimentacao_canonica_id`; módulo `packages/core/src/consolidacao/` (candidatos por regras, score, persist, aprovação); APIs Next.js; tela `/prestacao/[sessaoId]/consolidacao`. Reusa ingest/match existente; Kimi só para pares ambíguos. Baseado em testes Bahia (`2026-05-26-documentos-teste-ingestao-descobertas.md`).

**Tech Stack:** TypeScript, Drizzle, Neon Postgres, Next.js App Router, Vitest, OpenRouter (`moonshotai/kimi-k2.6`).

**Spec:** [docs/superpowers/specs/2026-05-26-consolidacao-extratos-design.md](../specs/2026-05-26-consolidacao-extratos-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema.ts` | `consolidacao_evento`, `consolidacao_linha`, `consolidacao_hipotese`; `sessao_prestacao.consolidar_extratos`; `movimentacao.movimentacao_canonica_id` |
| `packages/db/drizzle/0003_*.sql` | Migration gerada |
| `packages/core/src/consolidacao/types.ts` | Enums status, papel PDF, DTOs |
| `packages/core/src/consolidacao/classify-arquivo.ts` | PIX vs COMPLETO por nome/heurística |
| `packages/core/src/consolidacao/candidates.ts` | Pares cross-PDF, score, eventos únicos |
| `packages/core/src/consolidacao/candidates.test.ts` | Fixtures estilo PIX nome-only + completo com CPF |
| `packages/core/src/consolidacao/run.ts` | `consolidateSession` idempotente |
| `packages/core/src/consolidacao/approve.ts` | Merge + evidências + rematch |
| `packages/core/src/consolidacao/approve.test.ts` | Aprovar par → 1 canônica |
| `packages/core/src/consolidacao/ai.ts` | Kimi ambíguos (opcional env) |
| `packages/core/src/consolidacao/queries.ts` | GET lista eventos + linhas + hipóteses |
| `packages/core/src/index.ts` | Re-exports |
| `apps/web/app/api/prestacao/sessoes/route.ts` | `consolidarExtratos` no POST |
| `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/**` | run, list, aprovar, rejeitar, lote |
| `apps/web/components/prestacao/wizard.tsx` | Checkbox |
| `apps/web/hooks/use-prestacao-submit.ts` | Step `consolidacao`, redirect condicional |
| `apps/web/app/prestacao/[sessaoId]/consolidacao/page.tsx` | Tela revisão |
| `apps/web/components/prestacao/consolidacao-table.tsx` | Tabela + expand + lateral |

---

### Task 1: Schema — consolidação + sessão + movimentação

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: migration via `pnpm --filter @spc-up/db db:generate`

- [ ] **Step 1: Add constants and tables**

Em `packages/db/src/schema.ts`:

```typescript
export const CONSOLIDACAO_EVENTO_STATUS = {
  PENDENTE: "PENDENTE",
  APROVADO: "APROVADO",
  REJEITADO: "REJEITADO",
} as const;

export const CONSOLIDACAO_LINHA_PAPEL = {
  PIX: "PIX",
  COMPLETO: "COMPLETO",
  OUTRO: "OUTRO",
} as const;

export const consolidacaoEvento = pgTable(
  "consolidacao_evento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessaoPrestacaoId: uuid("sessao_prestacao_id")
      .notNull()
      .references(() => sessaoPrestacao.id),
    status: varchar("status", { length: 20 }).notNull().default("PENDENTE"),
    dataMovimento: date("data_movimento").notNull(),
    valor: numeric("valor", { precision: 15, scale: 2 }).notNull(),
    direcao: varchar("direcao", { length: 10 }).notNull(),
    confianca: real("confianca").notNull(),
    pessoaFisicaId: uuid("pessoa_fisica_id").references(() => pessoaFisica.id),
    pessoaJuridicaId: uuid("pessoa_juridica_id").references(() => pessoaJuridica.id),
    movimentacaoCanonicaId: uuid("movimentacao_canonica_id").references(() => movimentacao.id),
    justificativa: text("justificativa"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ix_consolidacao_evento_sessao").on(t.sessaoPrestacaoId, t.status)],
);

export const consolidacaoLinha = pgTable("consolidacao_linha", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventoId: uuid("evento_id")
    .notNull()
    .references(() => consolidacaoEvento.id, { onDelete: "cascade" }),
  movimentacaoId: uuid("movimentacao_id")
    .notNull()
    .references(() => movimentacao.id),
  arquivoIngestaoId: uuid("arquivo_ingestao_id").references(() => arquivoIngestao.id),
  papel: varchar("papel", { length: 20 }).notNull(),
});

export const consolidacaoHipotese = pgTable("consolidacao_hipotese", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventoId: uuid("evento_id")
    .notNull()
    .references(() => consolidacaoEvento.id, { onDelete: "cascade" }),
  tipo: varchar("tipo", { length: 40 }).notNull(),
  confianca: real("confianca").notNull(),
  payload: jsonb("payload").notNull(),
});
```

- [ ] **Step 2: Extend `sessao_prestacao` and `movimentacao`**

```typescript
// sessaoPrestacao — add column:
consolidarExtratos: boolean("consolidar_extratos").notNull().default(false),

// movimentacao — add column:
movimentacaoCanonicaId: uuid("movimentacao_canonica_id").references(
  (): AnyPgColumn => movimentacao.id,
),
```

Use self-reference pattern already in Drizzle docs; add relations `consolidacaoEvento` / `linhas` / `hipoteses` in `schema.ts`.

- [ ] **Step 3: Generate and apply migration**

Run: `pnpm --filter @spc-up/db db:generate`  
Run: `pnpm --filter @spc-up/db db:migrate`  
Expected: new SQL `0003_*.sql` with three tables + two columns.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): schema consolidacao multi-extrato"
```

---

### Task 2: Classify arquivo + candidate pairing (TDD)

**Files:**
- Create: `packages/core/src/consolidacao/types.ts`
- Create: `packages/core/src/consolidacao/classify-arquivo.ts`
- Create: `packages/core/src/consolidacao/candidates.ts`
- Create: `packages/core/src/consolidacao/candidates.test.ts`

- [ ] **Step 1: Write failing tests for PIX/completo pair**

`candidates.test.ts` — movimentações mock (sem DB):

```typescript
import { describe, expect, it } from "vitest";
import { buildConsolidacaoCandidates } from "./candidates";
import type { MovimentacaoCandidate } from "./types";

const pixLine: MovimentacaoCandidate = {
  id: "pix-1",
  arquivoIngestaoId: "arq-pix",
  nomeArquivo: "Extrato Jan PIX.pdf",
  dataMovimento: "2025-01-15",
  valor: "100.00",
  direcao: "ENTRADA",
  descricaoRaw: "GABRIEL REIS DA SILVA",
  cpfExtraido: null,
};

const completoLine: MovimentacaoCandidate = {
  id: "comp-1",
  arquivoIngestaoId: "arq-total",
  nomeArquivo: "EXTRATO TOTAL JANEIRO.pdf",
  dataMovimento: "2025-01-15",
  valor: "100.00",
  direcao: "ENTRADA",
  descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
  cpfExtraido: "12345678901",
};

describe("buildConsolidacaoCandidates", () => {
  it("pairs PIX nome-only with completo same date/value/direction", () => {
    const events = buildConsolidacaoCandidates([pixLine, completoLine], {
      pessoaByCpf: new Map([["12345678901", { kind: "PF" as const, id: "pf-1", nome: "GABRIEL REIS DA SILVA" }]]),
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.confianca).toBeGreaterThanOrEqual(0.9);
    expect(events[0]!.linhas.map((l) => l.papel)).toEqual(
      expect.arrayContaining(["PIX", "COMPLETO"]),
    );
  });

  it("does not pair different valores", () => {
    const events = buildConsolidacaoCandidates(
      [pixLine, { ...completoLine, valor: "200.00" }],
      { pessoaByCpf: new Map() },
    );
    expect(events.filter((e) => e.linhas.length === 2)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm exec vitest run packages/core/src/consolidacao/candidates.test.ts -v`  
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `classify-arquivo.ts`**

```typescript
export function classifyArquivoPapel(nomeArquivo: string): "PIX" | "COMPLETO" | "OUTRO" {
  if (/pix/i.test(nomeArquivo)) return "PIX";
  if (/total|completo|extrato/i.test(nomeArquivo)) return "COMPLETO";
  return "OUTRO";
}
```

- [ ] **Step 4: Implement `candidates.ts`**

Helpers:

- `extractCpfFromDescricao(descricaoRaw)` — reuse `extractDocumentCandidates` from `match/rules.ts`.
- `normalizeEventKey(m)` — `data|valor|direcao`.
- Pair loops: only across **different** `arquivoIngestaoId`.
- Score table from spec §5.3 (CPF match 0.95, CPF completo + PIX nome 0.90, etc.).
- Unpaired movimentações → evento single-linha com score from cadastro/CPF on line.
- `hipoteses`: segundo CPF candidato, segundo par PDF com score < winner - 0.15.

Export `buildConsolidacaoCandidates(movs, ctx): ConsolidacaoEventDraft[]`.

- [ ] **Step 5: Run tests — PASS**

Run: `pnpm exec vitest run packages/core/src/consolidacao/candidates.test.ts -v`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/consolidacao/
git commit -m "feat(core): consolidacao candidate pairing and scoring"
```

---

### Task 3: `consolidateSession` — load movimentações, persist eventos

**Files:**
- Create: `packages/core/src/consolidacao/run.ts`
- Create: `packages/core/src/consolidacao/run.test.ts`
- Modify: `packages/core/src/prestacao/sessao.ts` — `CreateSessaoInput.consolidarExtratos?`

- [ ] **Step 1: Extend `createSessao`**

`packages/core/src/prestacao/sessao.ts`:

```typescript
export interface CreateSessaoInput {
  // ...existing
  consolidarExtratos?: boolean;
}

// insert values:
consolidarExtratos: input.consolidarExtratos ?? false,
```

- [ ] **Step 2: Test `consolidateSession` skips when <2 PDFs**

`run.test.ts` with mocked `db` or test DB — assert returns `{ skipped: true, reason: "LESS_THAN_TWO_PDF" }`.

- [ ] **Step 3: Implement `consolidateSession`**

```typescript
export async function consolidateSession(db: Db, sessaoId: string): Promise<ConsolidateResult> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao?.consolidarExtratos) return { skipped: true, reason: "FLAG_OFF" };

  const pdfs = await listPdfIngestoesForSessao(db, sessaoId);
  if (pdfs.length < 2) return { skipped: true, reason: "LESS_THAN_TWO_PDF" };

  await db.delete(consolidacaoEvento).where(
    and(
      eq(consolidacaoEvento.sessaoPrestacaoId, sessaoId),
      eq(consolidacaoEvento.status, CONSOLIDACAO_EVENTO_STATUS.PENDENTE),
    ),
  );

  const movs = await loadMovimentacaoCandidates(db, sessaoId);
  const pessoaByCpf = await loadCadastroMapForMatching(db); // all PF/PJ or subset — Map cpf/cnpj → pessoa

  let drafts = buildConsolidacaoCandidates(movs, { pessoaByCpf });

  if (process.env.OPENROUTER_API_KEY) {
    drafts = await enrichAmbiguousWithAi(drafts, movs, sessao);
  }

  const eventoIds = await persistConsolidacaoDrafts(db, sessaoId, drafts);
  return { skipped: false, eventos: eventoIds.length };
}
```

`loadMovimentacaoCandidates`: join `movimentacao` + `arquivo_ingestao` where `movimentacao_canonica_id IS NULL` and status not EXPORTADO.

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/consolidacao/run.ts packages/core/src/prestacao/sessao.ts packages/core/src/index.ts
git commit -m "feat(core): consolidateSession persistence"
```

---

### Task 4: Aprovar / rejeitar evento

**Files:**
- Create: `packages/core/src/consolidacao/approve.ts`
- Create: `packages/core/src/consolidacao/approve.test.ts`

- [ ] **Step 1: Failing test — approve merges two movimentações**

Setup: 2 movimentações + 1 evento PENDENTE com 2 linhas. Call `approveConsolidacaoEvento(db, eventoId)`.

Expect:

- Uma movimentação canônica com `descricao_raw` enriquecida (contém CPF).
- Outra com `movimentacao_canonica_id` set.
- Evento `APROVADO`, `movimentacao_canonica_id` preenchido.
- `match_evidencia` com `CRUZAMENTO_PDF` e `CADASTRO_UF`.

- [ ] **Step 2: Implement `approveConsolidacaoEvento`**

Pick canônica: linha `COMPLETO` preferida; else higher ingest confianca.

```typescript
await db.update(movimentacao).set({
  movimentacaoCanonicaId: canonica.id,
  status: MOVIMENTACAO_STATUS.REJEITADO,
}).where(inArray(movimentacao.id, absorbedIds));

await db.update(movimentacao).set({
  descricaoRaw: enrichedDescricao,
  pessoaFisicaId: evento.pessoaFisicaId,
  confiancaGlobal: evento.confianca,
}).where(eq(movimentacao.id, canonica.id));

await applyDeterministicMatch(db, canonica.id);
await insertEvidenciasConsolidacao(db, canonica.id, evento);
```

Call `rematchPendingMovimentacoes(sessao.uf, sessao.exercicio)` after batch approve.

`rejectConsolidacaoEvento`: status REJEITADO only.

- [ ] **Step 3: Run tests**

Run: `pnpm exec vitest run packages/core/src/consolidacao/ -v`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(core): approve consolidacao merge and evidencias"
```

---

### Task 5: Kimi para ambíguos (opcional)

**Files:**
- Create: `packages/core/src/consolidacao/ai.ts`

- [ ] **Step 1: Implement `enrichAmbiguousWithAi`**

Only events with `0.45 <= confianca < 0.75` or multiple CPF hypotheses.

Reuse pattern from `packages/core/src/match/ai.ts` — `json_object`, Portuguese prompt, **no PDF bytes** — only `descricao_raw` snippets.

Cap adjusted confianca at `0.85`.

- [ ] **Step 2: Unit test with mocked fetch**

Assert prompt contains both descriptions and does not contain base64.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(core): kimi assist for ambiguous consolidacao pairs"
```

---

### Task 6: APIs

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/run/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/eventos/[eid]/aprovar/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/eventos/[eid]/rejeitar/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/aprovar-lote/route.ts`

- [ ] **Step 1: POST sessões — `consolidarExtratos`**

```typescript
const createSchema = z.object({
  // ...
  consolidarExtratos: z.boolean().optional(),
});
```

Pass to `createSessao`.

- [ ] **Step 2: GET consolidacao**

Returns `{ eventos, cadastroAlerta, pdfCount }` from `listConsolidacaoForSessao`.

`cadastroAlerta`: true when ≥1 linha PIX nome-only e nenhum `NOME_CADASTRO` possível (0 matches em `buildConsolidacaoCandidates` dry-run ou flag no run).

- [ ] **Step 3: POST consolidacao/run**

Calls `consolidateSession`; idempotent.

- [ ] **Step 4: POST aprovar / rejeitar / lote**

Body lote: `{ minConfianca?: number, ids?: string[] }`.

- [ ] **Step 5: Manual smoke**

Com `.env` e fixtures Bahia: criar sessão BA, upload 2 PDFs, `POST .../consolidacao/run`, `GET` lista >0 eventos.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/prestacao/
git commit -m "feat(web): api consolidacao extratos"
```

---

### Task 7: Wizard + submit redirect

**Files:**
- Modify: `apps/web/components/prestacao/wizard.tsx`
- Modify: `apps/web/hooks/use-prestacao-submit.ts`
- Modify: `apps/web/hooks/use-prestacao-submit.test.ts`

- [ ] **Step 1: Checkbox no wizard passo 5**

```tsx
<label className="flex items-center gap-2 text-sm">
  <input
    type="checkbox"
    checked={consolidarExtratos}
    onChange={(e) => setConsolidarExtratos(e.target.checked)}
  />
  Consolidar extratos (PIX + completo, etc.)
</label>
<p className="text-xs text-muted">
  Cruza PDFs com cadastro da UF e mostra confiança antes do kanban. Importe pessoas em Cadastro antes.
</p>
```

- [ ] **Step 2: Pass flag on create session**

`use-prestacao-submit.ts` — JSON body includes `consolidarExtratos`.

- [ ] **Step 3: New step id `consolidacao`**

```typescript
export type SubmitStepId = "session" | "upload" | "ingest" | "consolidacao" | "kanban";
```

After all uploads succeed:

```typescript
if (consolidarExtratos && pdfCount >= 2) {
  await fetch(`/api/prestacao/sessoes/${sessaoId}/consolidacao/run`, { method: "POST" });
  router.push(`/prestacao/${sessaoId}/consolidacao`);
} else {
  router.push(`/prestacao/${sessaoId}/kanban`);
}
```

Detect `pdfCount` from upload response metadata (`content_type` / `.pdf` extension per file).

- [ ] **Step 4: Test redirect logic**

Extend `use-prestacao-submit.test.ts` for `shouldRedirectToConsolidacao(consolidar, pdfCount)`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): wizard consolidar extratos and redirect"
```

---

### Task 8: UI consolidação

**Files:**
- Create: `apps/web/app/prestacao/[sessaoId]/consolidacao/page.tsx`
- Create: `apps/web/components/prestacao/consolidacao-table.tsx`
- Modify: `apps/web/components/prestacao/kanban-board.tsx` — link “Consolidar extratos”

- [ ] **Step 1: Page loads GET consolidacao**

Server component fetch sessão + eventos; pass to client table.

- [ ] **Step 2: Table row**

Columns: data, valor, direção, pessoa, confiança %, chips (PIX+completo, CPF cadastro).

Expand: two columns descricao_raw; lista evidencias `tipo` + `detalhe`; buttons Aprovar/Rejeitar calling API.

- [ ] **Step 3: Sidebar hipóteses**

When row selected, show `consolidacao_hipotese` payload.

- [ ] **Step 4: Toolbar**

“Aprovar selecionados (≥85%)”, “Ir ao kanban”.

- [ ] **Step 5: Kanban link**

If sessão `consolidarExtratos` && pending eventos > 0, banner with link back to consolidacao.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): consolidacao review UI"
```

---

### Task 9: Regressão Bahia + docs

**Files:**
- Create: `packages/core/src/consolidacao/fixtures.test.ts` (optional integration)
- Modify: `docs/superpowers/specs/2026-05-26-documentos-teste-ingestao-descobertas.md` — checklist item consolidação

- [ ] **Step 1: Fixture test with recorded movimentação shapes**

From analyze-test-docs output — build candidate array mimicking PIX + TOTAL; assert ≥1 event ≥0.9 confianca when cadastro map has CPF.

- [ ] **Step 2: Full core suite**

Run: `pnpm --filter @spc-up/core test`

- [ ] **Step 3: Update checklist §11**

Add step: “Revisar consolidação → aprovar pares PIX/completo → kanban”.

- [ ] **Step 4: Commit**

```bash
git commit -m "test(core): consolidacao bahia fixtures and docs"
```

---

## Spec coverage (self-review)

| Spec § | Task |
|--------|------|
| §2 Testes Bahia | Task 9, scoring Task 2 |
| §3 Decisões opt-in | Task 7 |
| §4 Arquitetura | Tasks 1–5 |
| §5 Algoritmo | Task 2 |
| §6 UI | Task 8 |
| §7 Aprovação | Task 4 |
| §8 APIs | Task 6 |
| §9 Erros | Task 3 skip paths, Task 6 cadastroAlerta |
| §10 Testes | Tasks 2, 4, 9 |

## Manual test (Bahia)

1. Import `pessoas bahia (1).xlsx` em Cadastro.
2. Nova prestação BA 2025, ☑ consolidar.
3. Upload `Extrato Jan PIX (1).pdf` + `EXTRATO TOTAL JANEIRO (1) (1).pdf`.
4. Tela consolidação: pares com confiança alta; aprovar lote.
5. Kanban: 1 card por evento aprovado; duplicatas linkadas.

---

*Plan complete.*
