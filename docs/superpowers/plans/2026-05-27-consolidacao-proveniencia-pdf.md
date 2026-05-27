# Proveniência PDF (consolidação + kanban) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rastrear por atributo de onde veio cada dado na consolidação (PDF com página/linha/bbox, cadastro UF, cruzamento) e exibir viewer PDF com highlight na consolidação e no kanban; apenas uploads novos têm origem completa.

**Architecture:** Tipos compartilhados em `@spc-up/core/provenance`; colunas jsonb em `movimentacao` e `consolidacao_evento`; ingest estende schema IA + fixa `pagina` por batch; `buildOrigemAtributos` no motor de consolidação; API proxy do PDF; componentes React `OrigemPanel` + `PdfOrigemViewer` (pdf.js).

**Tech Stack:** TypeScript, Drizzle, Neon Postgres, Next.js 15, Vitest, OpenRouter json_schema, `pdfjs-dist` (apps/web).

**Spec:** [docs/superpowers/specs/2026-05-27-consolidacao-proveniencia-pdf-design.md](../specs/2026-05-27-consolidacao-proveniencia-pdf-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/provenance/types.ts` | `OrigemExtracaoV1`, `OrigemRef`, `OrigemAtributosEvento`, `BboxNorm` |
| `packages/core/src/provenance/validate.ts` | `clampBbox`, `validateOrigemExtracao` |
| `packages/core/src/provenance/validate.test.ts` | bbox clamp, pagina bounds |
| `packages/core/src/provenance/build-origem-atributos.ts` | Mapa atributo → origens a partir de draft + movs |
| `packages/core/src/provenance/build-origem-atributos.test.ts` | Fixture PIX+completo + cadastro |
| `packages/core/src/provenance/attach-extracao.ts` | `origemFromExtratoItem(item, ctx)` |
| `packages/core/src/provenance/attach-extracao.test.ts` | batch page override |
| `packages/core/src/ingest/types.ts` | `ParsedTransactionRow.origemExtracao?` |
| `packages/core/src/ingest/ofx.ts` | Persist `origemExtracao` quando presente |
| `packages/core/src/ingest/pdf.ts` | Propagar origem em `rowsFromExtratoTransactions` |
| `packages/core/src/ai/openrouter.ts` | Schema + prompts `pagina`, `indice_linha`, `bbox` |
| `packages/core/src/consolidacao/types.ts` | `origemAtributos` no draft |
| `packages/core/src/consolidacao/candidates.ts` | Chamar `buildOrigemAtributos` |
| `packages/core/src/consolidacao/persist.ts` | Gravar `origem_atributos` |
| `packages/core/src/consolidacao/approve.ts` | Copiar `origem_extracao` + `origem_enriquecimento` |
| `packages/core/src/consolidacao/load.ts` | Carregar `origemExtracao` nos candidatos |
| `packages/core/src/consolidacao/queries.ts` | Expor `origemAtributos` na lista |
| `packages/core/src/prestacao/movimentacao-review.ts` | `origemExtracao`, `origemEnriquecimento` no detalhe |
| `packages/core/src/storage/read-arquivo.ts` | Ler buffer de `caminhoStorage` (local ou URL) |
| `packages/db/src/schema.ts` | 3 colunas jsonb |
| `packages/db/drizzle/0005_*.sql` | Migration |
| `apps/web/app/api/arquivos-ingestao/[id]/pdf/route.ts` | Stream PDF autenticado |
| `apps/web/components/prestacao/origens-panel.tsx` | Tabela origem por campo |
| `apps/web/components/prestacao/pdf-origem-viewer.tsx` | pdf.js + overlay bbox |
| `apps/web/components/prestacao/consolidacao-table.tsx` | Integrar `OrigemPanel` |
| `apps/web/components/prestacao/review-drawer.tsx` | Integrar `OrigemPanel` |

---

### Task 1: Tipos e validação de proveniência

**Files:**
- Create: `packages/core/src/provenance/types.ts`
- Create: `packages/core/src/provenance/validate.ts`
- Create: `packages/core/src/provenance/validate.test.ts`
- Modify: `packages/core/src/index.ts` (re-exports)

- [ ] **Step 1: Write failing tests**

```typescript
// packages/core/src/provenance/validate.test.ts
import { describe, expect, it } from "vitest";
import { clampBbox, validateOrigemExtracao } from "./validate";

describe("clampBbox", () => {
  it("drops invalid box", () => {
    expect(clampBbox({ x: 1.5, y: 0, w: 0.2, h: 0.1 })).toBeUndefined();
  });
  it("keeps valid box", () => {
    expect(clampBbox({ x: 0.1, y: 0.2, w: 0.3, h: 0.05 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.05,
    });
  });
});

describe("validateOrigemExtracao", () => {
  it("rejects pagina out of range", () => {
    expect(
      validateOrigemExtracao(
        { versao: 1, arquivoIngestaoId: "a", nomeArquivo: "x.pdf", pagina: 99, indiceLinha: 1 },
        3,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spc-up/core test packages/core/src/provenance/validate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types + validate**

```typescript
// packages/core/src/provenance/types.ts
export type BboxNorm = { x: number; y: number; w: number; h: number };

export type CampoExtrato =
  | "data"
  | "valor"
  | "direcao"
  | "cpf"
  | "cnpj"
  | "nome"
  | "descricao";

export type OrigemExtracaoV1 = {
  versao: 1;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number;
  indiceLinha: number;
  bbox?: BboxNorm;
  campos?: Partial<Record<CampoExtrato, { pagina: number; indiceLinha: number; bbox?: BboxNorm }>>;
};

export type OrigemRef =
  | {
      tipo: "PDF";
      movimentacaoId: string;
      arquivoIngestaoId: string;
      nomeArquivo: string;
      pagina: number;
      indiceLinha: number;
      bbox?: BboxNorm;
      campo: CampoExtrato | "linha_inteira";
    }
  | {
      tipo: "CADASTRO_UF";
      pessoaFisicaId?: string;
      pessoaJuridicaId?: string;
      matchTipo: "CPF_CADASTRO" | "CNPJ_CADASTRO" | "NOME_CADASTRO";
      documento?: string;
    }
  | {
      tipo: "CRUZAMENTO_PDF";
      movimentacaoIds: string[];
      regra: string;
      detalhe?: string;
    }
  | { tipo: "IA_CRUZAMENTO"; confianca: number; detalhe?: string }
  | { tipo: "INDISPONIVEL"; motivo: string };

export type OrigemAtributosEvento = {
  versao: 1;
  dataMovimento: OrigemRef[];
  valor: OrigemRef[];
  direcao: OrigemRef[];
  pessoa: OrigemRef[];
  confianca: OrigemRef[];
};

export type OrigemEnriquecimentoV1 = {
  versao: 1;
  refs: OrigemRef[];
};
```

```typescript
// packages/core/src/provenance/validate.ts
import type { BboxNorm, OrigemExtracaoV1 } from "./types";

export function clampBbox(bbox: BboxNorm): BboxNorm | undefined {
  const { x, y, w, h } = bbox;
  if ([x, y, w, h].some((n) => !Number.isFinite(n) || n < 0 || n > 1)) return undefined;
  if (w <= 0 || h <= 0) return undefined;
  if (x + w > 1.001 || y + h > 1.001) return undefined;
  return { x, y, w, h };
}

export function validateOrigemExtracao(
  raw: Omit<OrigemExtracaoV1, "bbox" | "campos"> & {
    bbox?: BboxNorm;
    campos?: OrigemExtracaoV1["campos"];
  },
  pageCount: number,
): OrigemExtracaoV1 | null {
  if (raw.pagina < 1 || raw.pagina > pageCount) return null;
  if (raw.indiceLinha < 1) return null;
  const bbox = raw.bbox ? clampBbox(raw.bbox) : undefined;
  return { ...raw, versao: 1, bbox };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @spc-up/core test packages/core/src/provenance/validate.test.ts`
Expected: PASS

---

### Task 2: Schema Drizzle + migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: migration via `pnpm --filter @spc-up/db db:generate`

- [ ] **Step 1: Add jsonb columns**

Em `movimentacao`:

```typescript
origemExtracao: jsonb("origem_extracao").$type<import("@spc-up/core").OrigemExtracaoV1 | null>(),
origemEnriquecimento: jsonb("origem_enriquecimento").$type<import("@spc-up/core").OrigemEnriquecimentoV1 | null>(),
```

Em `consolidacaoEvento`:

```typescript
origemAtributos: jsonb("origem_atributos").$type<import("@spc-up/core").OrigemAtributosEvento | null>(),
```

Preferir tipos locais duplicados em `schema.ts` como `unknown` jsonb se import circular — usar `jsonb("origem_extracao")` sem `$type` se necessário.

- [ ] **Step 2: Generate and apply migration**

Run: `pnpm --filter @spc-up/db db:generate`
Run: `pnpm --filter @spc-up/db db:migrate` (ou comando do projeto)

Expected: novo SQL `0005_*.sql` com três colunas nullable

---

### Task 3: Schema IA + página por batch na extração

**Files:**
- Modify: `packages/core/src/ai/openrouter.ts`
- Create: `packages/core/src/provenance/attach-extracao.ts`
- Create: `packages/core/src/provenance/attach-extracao.test.ts`
- Modify: `packages/core/src/ai/openrouter-extrato.test.ts` (assert schema fields)

- [ ] **Step 1: Extend `EXTRATO_TRANSACTION_ITEM_SCHEMA`**

Adicionar em `properties` (não em `required` para compatibilidade json_object):

```typescript
pagina: { type: "integer", description: "1-based page number in the PDF" },
indice_linha: { type: "integer", description: "1-based row index on that page" },
bbox: {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
  description: "Normalized 0-1 box around the transaction row",
},
```

Atualizar `KIMI_EXTRATO_SYSTEM_PROMPT` e `GEMINI_EXTRATO_SYSTEM_PROMPT` com: incluir `pagina`, `indice_linha`, `bbox` por transação; não inventar linhas.

- [ ] **Step 2: Write failing test for page override**

```typescript
// packages/core/src/provenance/attach-extracao.test.ts
import { describe, expect, it } from "vitest";
import { origemFromExtratoItem } from "./attach-extracao";

describe("origemFromExtratoItem", () => {
  it("uses batch page when model returns different page", () => {
    const o = origemFromExtratoItem(
      { pagina: 9, indice_linha: 2, bbox: { x: 0.1, y: 0.2, w: 0.8, h: 0.05 } },
      {
        arquivoIngestaoId: "aid",
        nomeArquivo: "extrato.pdf",
        batchPagina: 2,
        pageCount: 3,
      },
    );
    expect(o?.pagina).toBe(2);
    expect(o?.indiceLinha).toBe(2);
  });
});
```

- [ ] **Step 3: Implement `attach-extracao.ts`**

```typescript
import { validateOrigemExtracao } from "./validate";
import type { OrigemExtracaoV1 } from "./types";

export type AttachExtracaoCtx = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  batchPagina: number;
  pageCount: number;
};

export function origemFromExtratoItem(
  item: Record<string, unknown>,
  ctx: AttachExtracaoCtx,
): OrigemExtracaoV1 | null {
  const indiceLinha = Number(item.indice_linha ?? item.indiceLinha ?? 1);
  const paginaModel = Number(item.pagina);
  const pagina = Number.isFinite(paginaModel) && paginaModel >= 1 ? ctx.batchPagina : ctx.batchPagina;
  const bboxRaw = item.bbox as { x: number; y: number; w: number; h: number } | undefined;
  return validateOrigemExtracao(
    {
      versao: 1,
      arquivoIngestaoId: ctx.arquivoIngestaoId,
      nomeArquivo: ctx.nomeArquivo,
      pagina,
      indiceLinha: Number.isFinite(indiceLinha) ? indiceLinha : 1,
      bbox: bboxRaw,
    },
    ctx.pageCount,
  );
}
```

- [ ] **Step 4: Patch `extractTransactionsFromPdfFile` loop**

Em `openrouter.ts`, após cada `extractTransactionsFromSinglePdfBuffer`, anotar cada transação:

```typescript
for (const tx of part.transacoes) {
  tx.__batch_pagina = index + 1; // campo interno, removido antes do cache
}
```

Antes de `writeExtratoPdfCache`, remover `__batch_pagina` ou não cachear até ingest anexar origem (preferível: anexar origem só em `ingestPdfExtrato`, não no cache global).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @spc-up/core test packages/core/src/provenance/attach-extracao.test.ts`
Run: `pnpm --filter @spc-up/core test packages/core/src/ai/openrouter-extrato.test.ts`

---

### Task 4: Ingest persiste `origem_extracao`

**Files:**
- Modify: `packages/core/src/ingest/types.ts`
- Modify: `packages/core/src/ingest/ofx.ts`
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/ingest/pdf.test.ts`

- [ ] **Step 1: Extend `ParsedTransactionRow`**

```typescript
import type { OrigemExtracaoV1 } from "../provenance/types";

export interface ParsedTransactionRow {
  // ...existing fields
  origemExtracao?: OrigemExtracaoV1 | null;
}
```

- [ ] **Step 2: `persistTransactions` inserts jsonb**

```typescript
origemExtracao: row.origemExtracao ?? null,
```

- [ ] **Step 3: `ingestPdfExtrato` builds origem per row**

Após `rowsFromExtratoTransactions`, se extração veio de arquivo (não texto puro), zip `extraction.transacoes[i]` com `rows[i]`:

```typescript
const pageCount = await getPdfPageCount(buffer);
const attachCtx = { arquivoIngestaoId: arquivoId, nomeArquivo: filename, pageCount };
// Para vision: mapear batch — passar pageCount e, por item, batchPagina do campo __batch_pagina ou 1
for (let i = 0; i < rows.length; i++) {
  const item = extraction.transacoes[i];
  if (item && !hasEnoughText) {
    rows[i]!.origemExtracao = origemFromExtratoItem(item, {
      ...attachCtx,
      batchPagina: Number(item.__batch_pagina ?? 1),
    });
  }
}
```

Texto puro (`hasEnoughText`): v1 deixa `origemExtracao` null (spec: foco em PDF visão multipágina).

- [ ] **Step 4: Test unitário ingest**

Mock `extractTransactionsFromPdfFile` retornando transação com `indice_linha` + verificar `persistTransactions` recebe `origemExtracao` (spy).

Run: `pnpm --filter @spc-up/core test packages/core/src/ingest/pdf.test.ts`

---

### Task 5: `buildOrigemAtributos` + consolidação

**Files:**
- Create: `packages/core/src/provenance/build-origem-atributos.ts`
- Create: `packages/core/src/provenance/build-origem-atributos.test.ts`
- Modify: `packages/core/src/consolidacao/types.ts`
- Modify: `packages/core/src/consolidacao/candidates.ts`
- Modify: `packages/core/src/consolidacao/persist.ts`
- Modify: `packages/core/src/consolidacao/load.ts`
- Modify: `packages/core/src/consolidacao/queries.ts`

- [ ] **Step 1: Extend types**

```typescript
// consolidacao/types.ts
import type { OrigemAtributosEvento } from "../provenance/types";

export type MovimentacaoCandidate = {
  // ...existing
  origemExtracao: OrigemExtracaoV1 | null;
};

export type ConsolidacaoEventDraft = {
  // ...existing
  origemAtributos: OrigemAtributosEvento;
};
```

- [ ] **Step 2: Failing test Bahia-style**

```typescript
// build-origem-atributos.test.ts — par PIX sem CPF + completo com CPF
// Expect: pessoa has CRUZAMENTO_PDF + PDF on completo; dataMovimento has 2 PDF refs
```

- [ ] **Step 3: Implement `buildOrigemAtributos(draft, movById, ctx)`**

Regras:
- Para cada `linha` do draft: se `mov.origemExtracao`, push `PDF` em `dataMovimento`, `valor`, `direcao` com `campo` correspondente
- Se `draft.pessoaFisicaId` veio de `NOME_CADASTRO` → `CADASTRO_UF`; se CPF no completo → `PDF` + possível `CRUZAMENTO_PDF` com `regra` usada em `candidates.ts`
- Se nenhuma origem: `INDISPONIVEL` com motivo `ingestao_anterior`
- `confianca`: `CRUZAMENTO_PDF` com regra do score

- [ ] **Step 4: Wire `buildConsolidacaoCandidates`**

No final de cada evento: `origemAtributos: buildOrigemAtributos(...)`

- [ ] **Step 5: `persistConsolidacaoDrafts`**

```typescript
origemAtributos: draft.origemAtributos,
```

- [ ] **Step 6: `loadMovimentacaoCandidates`**

Select `movimentacao.origemExtracao`.

- [ ] **Step 7: `listConsolidacaoForSessao`**

Map `origemAtributos: e.origemAtributos`.

Run: `pnpm --filter @spc-up/core test packages/core/src/provenance/build-origem-atributos.test.ts`
Run: `pnpm --filter @spc-up/core test packages/core/src/consolidacao/candidates.test.ts`

---

### Task 6: Aprovação copia origem para canônica

**Files:**
- Modify: `packages/core/src/consolidacao/approve.ts`
- Create: `packages/core/src/consolidacao/approve-provenance.test.ts`

- [ ] **Step 1: Failing test**

Aprovar evento com 2 linhas (PIX sem origem, COMPLETO com origem) → canônica COMPLETO tem `origemExtracao`; `origemEnriquecimento.refs` contém `CADASTRO_UF` se evento tinha pessoa por cadastro.

- [ ] **Step 2: Implement**

```typescript
const canonicaMov = evento.linhas.find((l) => l.movimentacaoId === canonicaId)!.movimentacao;
const origemExtracao = canonicaMov.origemExtracao;
const refsFromEvento = evento.origemAtributos;
const enriquecimento =
  refsFromEvento == null
    ? null
    : {
        versao: 1 as const,
        refs: [
          ...refsFromEvento.pessoa.filter((r) => r.tipo !== "PDF"),
          ...refsFromEvento.confianca,
        ],
      };

await db.update(movimentacao).set({
  // ...existing
  origemExtracao,
  origemEnriquecimento: enriquecimento,
}).where(eq(movimentacao.id, canonicaId));
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter @spc-up/core test packages/core/src/consolidacao/approve-provenance.test.ts`

---

### Task 7: API PDF + detalhe movimentação

**Files:**
- Create: `packages/core/src/storage/read-arquivo.ts`
- Create: `apps/web/app/api/arquivos-ingestao/[id]/pdf/route.ts`
- Modify: `packages/core/src/prestacao/movimentacao-review.ts`
- Modify: `apps/web/app/api/movimentacoes/[id]/route.ts` (já retorna `item`)

- [ ] **Step 1: `readArquivoIngestaoBuffer`**

```typescript
export async function readArquivoIngestaoBuffer(caminhoStorage: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(caminhoStorage)) {
    const res = await fetch(caminhoStorage);
    if (!res.ok) throw new Error("Falha ao baixar PDF");
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(caminhoStorage);
}
```

- [ ] **Step 2: Route GET pdf**

```typescript
// apps/web/app/api/arquivos-ingestao/[id]/pdf/route.ts
// requireSession → load arquivo_ingestao → verify sessão/UF → read buffer → Response(buffer, {
//   headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline" }
// })
```

- [ ] **Step 3: Extend `MovimentacaoDetalhe`**

```typescript
origemExtracao: OrigemExtracaoV1 | null;
origemEnriquecimento: OrigemEnriquecimentoV1 | null;
origemAtributos: OrigemAtributosEvento | null; // se movimentação ainda ligada a evento pendente — opcional v1: só extracao+enriquecimento
```

Mapear colunas do ORM no return de `getMovimentacaoDetalhe`.

- [ ] **Step 4: Manual smoke**

Upload novo PDF → GET `/api/arquivos-ingestao/{id}/pdf` retorna 200 `application/pdf`.

---

### Task 8: UI — `OrigemPanel` + viewer

**Files:**
- Modify: `apps/web/package.json` — add `"pdfjs-dist": "^4.10.38"`
- Create: `apps/web/components/prestacao/origens-panel.tsx`
- Create: `apps/web/components/prestacao/pdf-origem-viewer.tsx`
- Modify: `apps/web/components/prestacao/consolidacao-table.tsx`
- Modify: `apps/web/components/prestacao/review-drawer.tsx`

- [ ] **Step 1: Install dependency**

Run: `pnpm --filter web add pdfjs-dist`

- [ ] **Step 2: `PdfOrigemViewer` (client component)**

```tsx
"use client";
// dynamic import pdfjs-dist
// props: arquivoIngestaoId, pagina, bbox?, nomeArquivo
// fetch `/api/arquivos-ingestao/${id}/pdf` → arrayBuffer → getDocument
// on render page pagina: canvas + absolute div overlay from bbox (left: x*100%, etc.)
```

Worker: `pdfjs-dist/build/pdf.worker.min.mjs` via `GlobalWorkerOptions.workerSrc` (copiar para `public/` ou CDN v4).

- [ ] **Step 3: `OrigemPanel`**

Props: `origemAtributos?: OrigemAtributosEvento | null`, `origemExtracao?`, `origemEnriquecimento?`, `arquivoIngestaoId?`.

Tabela: Atributo | Fonte | Detalhe | Ação.

- `PDF` + ids → botão abre modal com `PdfOrigemViewer`
- `CADASTRO_UF` → Link `/pessoas`
- `INDISPONIVEL` → texto muted

- [ ] **Step 4: Consolidacao table**

Extend `ConsolidacaoEventoRow` com `origemAtributos`. No expand, render `<OrigemPanel origemAtributos={ev.origemAtributos} />` abaixo das linhas PIX/completo.

- [ ] **Step 5: Review drawer**

Após carregar `detalhe`, render `<OrigemPanel origemExtracao={...} origemEnriquecimento={...} />`.

Se `origemExtracao == null` → mensagem "Origem indisponível (ingestão anterior)".

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter web typecheck`

---

### Task 9: Regressão e checklist manual

**Files:**
- Modify: `packages/core/src/consolidacao/bahia-fixture.test.ts` (assert `origemAtributos` quando mocks têm origem)

- [ ] **Step 1: Run core tests**

Run: `pnpm --filter @spc-up/core test`

- [ ] **Step 2: Checklist manual (fixtures Bahia)**

1. Importar cadastro BA; nova sessão com consolidar + `Extrato Jan PIX` + `EXTRATO TOTAL JANEIRO`
2. Consolidação expandida → origem por campo com PDF + cadastro/cruzamento
3. "Ver no PDF" → página correta + retângulo visível
4. Aprovar → kanban drawer mostra mesma origem na canônica
5. Sessão antiga (pré-deploy) → "Origem indisponível"

---

## Spec coverage (self-review)

| Spec § | Task |
|--------|------|
| §4 modelo jsonb | Task 2 |
| §5 ingest + IA | Tasks 3–4 |
| §6 consolidacao origem_atributos | Task 5 |
| §4.3 pós-aprovação | Task 6 |
| §7 APIs | Task 7 |
| §8 UI | Task 8 |
| §10 testes | Tasks 1, 5, 6, 9 |
| Legado sem reprocess | Tasks 4, 8 (INDISPONIVEL) |

No TBDs. `origemAtributos` no detalhe kanban v1: apenas `origemExtracao` + `origemEnriquecimento` (evento pendente não necessário no drawer).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-consolidacao-proveniencia-pdf.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  

**2. Inline Execution** — implement in this session with checkpoints  

Which approach do you want?
