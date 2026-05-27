# Gemini 3.5 Flash default (extrato + match) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `google/gemini-3.5-flash` the default OpenRouter model for bank-statement PDF extraction and movimentação match, via a centralized model profile, Gemini-native PDF batching, and Kimi preserved as env override.

**Architecture:** New `model-profile.ts` maps slug → response format, PDF plugins, batching strategy, and prompt variant. `openrouter.ts` and `pdf-split.ts` consult the profile instead of `isKimiModel()` branches. Match uses the same default slug with existing `json_schema`.

**Tech Stack:** TypeScript, Vitest, OpenRouter HTTP API, `pdf-lib`, monorepo `packages/core`.

**Spec:** [docs/superpowers/specs/2026-05-27-gemini-default-model-design.md](../specs/2026-05-27-gemini-default-model-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/ai/model-profile.ts` | **Create** — `resolveModelProfile`, constants |
| `packages/core/src/ai/model-profile.test.ts` | **Create** — profile matrix tests |
| `packages/core/src/ingest/pdf-split.ts` | `shouldBatchPdfVision` uses profile |
| `packages/core/src/ingest/pdf-split.test.ts` | **Extend** — batching gemini vs kimi |
| `packages/core/src/ai/openrouter.ts` | Defaults, profile wiring, Gemini prompt, OCR gate, nome heuristic |
| `packages/core/src/ai/openrouter-extrato.test.ts` | Default expectations → Gemini |
| `packages/core/src/ai/openrouter-extrato.integration.test.ts` | Gemini default suite; Kimi optional |
| `packages/core/src/match/ai.ts` | `DEFAULT_MODEL` → Gemini |
| `packages/core/src/index.ts` | Export `resolveModelProfile` if public API needed |
| `.env.example`, `apps/web/.env.example` | Defaults + comments |
| `docs/superpowers/specs/2026-05-26-documentos-teste-ingestao-descobertas.md` | Metrics / env section |
| `docs/piloto-checklist.md` | Default model line |

---

### Task 1: Model profile module

**Files:**
- Create: `packages/core/src/ai/model-profile.ts`
- Create: `packages/core/src/ai/model-profile.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/ai/model-profile.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXTRATO_MODEL,
  DEFAULT_MATCH_MODEL,
  resolveModelProfile,
} from "./model-profile";

describe("resolveModelProfile", () => {
  it("exposes Gemini defaults", () => {
    expect(DEFAULT_EXTRATO_MODEL).toBe("google/gemini-3.5-flash");
    expect(DEFAULT_MATCH_MODEL).toBe("google/gemini-3.5-flash");
  });

  it("returns kimi profile", () => {
    const p = resolveModelProfile("moonshotai/kimi-k2.6");
    expect(p.responseFormat).toBe("json_object");
    expect(p.pdfBatching).toBe("kimi_conservative");
    expect(p.pdfPlugins).toEqual([
      { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    ]);
    expect(p.ocrTextFallback).toBe(true);
    expect(p.extratoPromptVariant).toBe("kimi");
  });

  it("returns gemini profile", () => {
    const p = resolveModelProfile("google/gemini-3.5-flash");
    expect(p.responseFormat).toBe("json_schema");
    expect(p.pdfBatching).toBe("gemini_native");
    expect(p.pdfPlugins).toBeNull();
    expect(p.ocrTextFallback).toBe(false);
    expect(p.extratoPromptVariant).toBe("gemini");
  });

  it("falls back unknown slugs to gemini_native", () => {
    const p = resolveModelProfile("anthropic/claude-sonnet-4");
    expect(p.pdfBatching).toBe("gemini_native");
    expect(p.responseFormat).toBe("json_schema");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && pnpm exec vitest run src/ai/model-profile.test.ts -v
```

Expected: FAIL — cannot find module `./model-profile`

- [ ] **Step 3: Implement `model-profile.ts`**

Create `packages/core/src/ai/model-profile.ts`:

```typescript
export const DEFAULT_EXTRATO_MODEL = "google/gemini-3.5-flash";
export const DEFAULT_MATCH_MODEL = "google/gemini-3.5-flash";

export type ResponseFormatKind = "json_schema" | "json_object";
export type PdfBatchingStrategy = "gemini_native" | "kimi_conservative";
export type ExtratoPromptVariant = "gemini" | "kimi";

export interface ModelProfile {
  slug: string;
  responseFormat: ResponseFormatKind;
  pdfBatching: PdfBatchingStrategy;
  pdfPlugins: Array<{ id: string; pdf?: { engine: string } }> | null;
  ocrTextFallback: boolean;
  extratoPromptVariant: ExtratoPromptVariant;
}

const MISTRAL_OCR_PLUGINS: ModelProfile["pdfPlugins"] = [
  { id: "file-parser", pdf: { engine: "mistral-ocr" } },
];

const GEMINI_PROFILE: Omit<ModelProfile, "slug"> = {
  responseFormat: "json_schema",
  pdfBatching: "gemini_native",
  pdfPlugins: null,
  ocrTextFallback: false,
  extratoPromptVariant: "gemini",
};

const KIMI_PROFILE: Omit<ModelProfile, "slug"> = {
  responseFormat: "json_object",
  pdfBatching: "kimi_conservative",
  pdfPlugins: MISTRAL_OCR_PLUGINS,
  ocrTextFallback: true,
  extratoPromptVariant: "kimi",
};

export function resolveModelProfile(model: string): ModelProfile {
  const slug = model.trim();
  if (/kimi/i.test(slug)) {
    return { slug, ...KIMI_PROFILE };
  }
  return { slug, ...GEMINI_PROFILE };
}

/** @deprecated Use resolveModelProfile(model).pdfBatching === "kimi_conservative" */
export function isKimiModel(model: string): boolean {
  return resolveModelProfile(model).pdfBatching === "kimi_conservative";
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/core && pnpm exec vitest run src/ai/model-profile.test.ts -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/model-profile.ts packages/core/src/ai/model-profile.test.ts
git commit -m "feat(core): add OpenRouter model profile for Gemini/Kimi"
```

---

### Task 2: PDF batching by profile

**Files:**
- Modify: `packages/core/src/ingest/pdf-split.ts`
- Modify: `packages/core/src/ingest/pdf-split.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/ingest/pdf-split.test.ts`:

```typescript
import { shouldBatchPdfVision } from "./pdf-split";

describe("shouldBatchPdfVision", () => {
  const smallBuf = Buffer.alloc(50_000);
  const largeBuf = Buffer.alloc(250_000);

  it("gemini: does not batch 2 pages under byte threshold", () => {
    expect(
      shouldBatchPdfVision(smallBuf, 2, "google/gemini-3.5-flash"),
    ).toBe(false);
  });

  it("gemini: batches when over OPENROUTER_PDF_SPLIT_MIN_BYTES", () => {
    expect(
      shouldBatchPdfVision(largeBuf, 1, "google/gemini-3.5-flash"),
    ).toBe(true);
  });

  it("kimi: batches 2 pages even when small", () => {
    expect(
      shouldBatchPdfVision(smallBuf, 2, "moonshotai/kimi-k2.6"),
    ).toBe(true);
  });

  it("kimi: batches single page >= 80KB", () => {
    const buf = Buffer.alloc(90_000);
    expect(shouldBatchPdfVision(buf, 1, "moonshotai/kimi-k2.6")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && pnpm exec vitest run src/ingest/pdf-split.test.ts -v
```

Expected: FAIL — `shouldBatchPdfVision` not exported or wrong behavior

- [ ] **Step 3: Update `pdf-split.ts`**

At top add:

```typescript
import { resolveModelProfile } from "../ai/model-profile";
```

Replace `shouldBatchPdfVision` body with:

```typescript
export function shouldBatchPdfVision(
  buffer: Buffer,
  pageCount: number,
  model: string,
): boolean {
  const profile = resolveModelProfile(model);

  if (buffer.length >= resolvePdfSplitMinBytes()) {
    return true;
  }

  if (profile.pdfBatching === "kimi_conservative") {
    if (pageCount > 1) {
      return true;
    }
    return buffer.length >= 80_000;
  }

  // gemini_native: only batch multi-page when over byte threshold (handled above)
  return false;
}
```

Remove the old trailing line `return /kimi/i.test(model) && buffer.length >= 80_000`.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/core && pnpm exec vitest run src/ingest/pdf-split.test.ts -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/pdf-split.ts packages/core/src/ingest/pdf-split.test.ts
git commit -m "feat(core): gemini-native PDF batching via model profile"
```

---

### Task 3: Wire openrouter to model profile + Gemini default

**Files:**
- Modify: `packages/core/src/ai/openrouter.ts`

- [ ] **Step 1: Update imports and default**

```typescript
import {
  DEFAULT_EXTRATO_MODEL,
  resolveModelProfile,
  type ModelProfile,
} from "./model-profile";
```

Remove local `DEFAULT_PDF_MODEL = "moonshotai/kimi-k2.6"`.

Remove or re-export `isKimiModel` from `./model-profile` (delete duplicate in openrouter.ts if moved).

Change:

```typescript
const DEFAULT_PDF_MODEL = DEFAULT_EXTRATO_MODEL;
```

Or use `DEFAULT_EXTRATO_MODEL` directly in `resolveExtratoModel`.

- [ ] **Step 2: Add Gemini extrato prompt**

After `KIMI_EXTRATO_SYSTEM_PROMPT`, add:

```typescript
const GEMINI_EXTRATO_SYSTEM_PROMPT =
  "Você extrai transações de extrato bancário brasileiro (PDF ou texto). " +
  'Responda APENAS JSON válido no schema: {"transacoes":[{"data":"YYYY-MM-DD","valor":0,"direcao":"ENTRADA|SAIDA",' +
  '"descricao":"...","nome":"...","cpf":"11digitos","cnpj":"14digitos"}]}. ' +
  "Use ENTRADA para crédito e SAIDA para débito. Preencha nome com o contraparte quando visível; cpf/cnpj só dígitos. " +
  "Não invente linhas.";
```

Replace `extratoSystemPrompt`:

```typescript
function extratoSystemPrompt(model: string): string {
  const variant = resolveModelProfile(model).extratoPromptVariant;
  return variant === "kimi" ? KIMI_EXTRATO_SYSTEM_PROMPT : GEMINI_EXTRATO_SYSTEM_PROMPT;
}
```

Replace `buildStructuredResponseFormat`:

```typescript
function buildStructuredResponseFormat(
  model: string,
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (resolveModelProfile(model).responseFormat === "json_object") {
    return { type: "json_object" };
  }
  return {
    type: "json_schema",
    json_schema: { name, strict: true, schema },
  };
}
```

Replace `withPdfParserPlugins`:

```typescript
function withPdfParserPlugins(
  payload: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const plugins = resolveModelProfile(model).pdfPlugins;
  if (!plugins) {
    return payload;
  }
  return { ...payload, plugins };
}
```

In `buildExtratoFilePayload` user text branch, use profile:

```typescript
text:
  resolveModelProfile(model).extratoPromptVariant === "kimi"
    ? KIMI_EXTRATO_USER_PDF
    : "Extraia todas as transações visíveis neste extrato. Retorne somente o JSON.",
```

- [ ] **Step 3: Gate OCR fallback**

In `extractTransactionsFromSinglePdfBuffer`, replace:

```typescript
  if (extraction.transacoes.length === 0 && ocrText.length >= MIN_TEXT_CHARS) {
```

with:

```typescript
  const profile = resolveModelProfile(model);
  if (
    profile.ocrTextFallback &&
    extraction.transacoes.length === 0 &&
    ocrText.length >= MIN_TEXT_CHARS
  ) {
```

- [ ] **Step 4: Update failing unit test for default model**

In `openrouter-extrato.test.ts`, change:

```typescript
  it("does not fall back to OPENROUTER_MODEL (Kimi)", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "anthropic/claude-sonnet-4";
    expect(resolveExtratoModel()).toBe("moonshotai/kimi-k2.6");
  });
```

to:

```typescript
  it("does not fall back to OPENROUTER_MODEL", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
    expect(resolveExtratoModel()).toBe("google/gemini-3.5-flash");
  });
```

Add test for Gemini PDF without plugins:

```typescript
  it("Gemini PDF extrato uses json_schema and no plugins", async () => {
    process.env.OPENROUTER_CACHE = "0";
    const mockFetch = vi.fn().mockResolvedValue(mockOpenRouterResponse(SAMPLE_EXTRATO));
    const buf = Buffer.from("%PDF-1.4 demo");

    await extractTransactionsFromPdfFile(buf, {
      fetch: mockFetch,
      apiKey: "test-key",
      filename: "extrato.pdf",
      model: "google/gemini-3.5-flash",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      response_format: { type: string; json_schema?: { name: string } };
      plugins?: unknown;
    };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema?.name).toBe("extrato_transacoes");
    expect(body.plugins).toBeUndefined();
  });
```

- [ ] **Step 5: Run unit tests**

```bash
cd packages/core && pnpm exec vitest run src/ai/openrouter-extrato.test.ts src/ai/model-profile.test.ts -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/openrouter.ts packages/core/src/ai/openrouter-extrato.test.ts
git commit -m "feat(core): wire extrato OpenRouter to Gemini model profile"
```

---

### Task 4: Nome heuristic (pós-processo)

**Files:**
- Modify: `packages/core/src/ai/openrouter.ts`
- Modify: `packages/core/src/ai/openrouter-extrato.test.ts`

- [ ] **Step 1: Write failing test**

Add to `openrouter-extrato.test.ts`:

```typescript
import { normalizeExtratoItemForTests } from "./openrouter";
```

If `normalizeExtratoItem` is not exported, export it as `export function normalizeExtratoItem` (already exists — export for test only or test via `extractTransactionsFromPdfText` mock).

Prefer testing through public API — add test:

```typescript
  it("copies long descricao to nome when nome missing", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockOpenRouterResponse({
        transacoes: [
          {
            data: "2025-01-02",
            valor: 10,
            direcao: "ENTRADA",
            descricao: "GABRIEL REIS DA SILVA",
          },
        ],
      }),
    );

    const result = await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "test-key",
      model: "google/gemini-3.5-flash",
    });

    expect(result.transacoes[0]?.nome).toBe("GABRIEL REIS DA SILVA");
  });

  it("does not copy short bank codes to nome", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      mockOpenRouterResponse({
        transacoes: [
          {
            data: "2025-01-02",
            valor: 10,
            direcao: "ENTRADA",
            descricao: "CRED TEV",
          },
        ],
      }),
    );

    const result = await extractTransactionsFromPdfText("extrato", {
      fetch: mockFetch,
      apiKey: "test-key",
      model: "google/gemini-3.5-flash",
    });

    expect(result.transacoes[0]?.nome).toBeUndefined();
  });
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && pnpm exec vitest run src/ai/openrouter-extrato.test.ts -t "copies long descricao" -v
```

- [ ] **Step 3: Implement heuristic in `normalizeExtratoItem`**

Add helper above `normalizeExtratoItem`:

```typescript
const SHORT_BANK_CODE = /^[A-Z0-9][A-Z0-9\s.\-/]{2,14}$/;

function inferNomeFromDescricao(descricao: string): string | undefined {
  const text = descricao.trim();
  if (text.length < 8) {
    return undefined;
  }
  if (SHORT_BANK_CODE.test(text)) {
    return undefined;
  }
  return text;
}
```

Inside `normalizeExtratoItem`, after contraparte → nome logic:

```typescript
  const nomeStr = String(out.nome ?? "").trim();
  const descricaoStr = String(out.descricao ?? "").trim();
  if (!nomeStr && descricaoStr) {
    const inferred = inferNomeFromDescricao(descricaoStr);
    if (inferred) {
      out.nome = inferred;
    }
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && pnpm exec vitest run src/ai/openrouter-extrato.test.ts -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/openrouter.ts packages/core/src/ai/openrouter-extrato.test.ts
git commit -m "feat(core): infer extrato nome from descricao for Gemini"
```

---

### Task 5: Match default → Gemini

**Files:**
- Modify: `packages/core/src/match/ai.ts`

- [ ] **Step 1: Change default and comment**

```typescript
import { DEFAULT_MATCH_MODEL } from "../ai/model-profile";

const DEFAULT_MODEL = DEFAULT_MATCH_MODEL;
```

Update JSDoc on `evaluateMovimentacaoWithAi` from "Kimi" to "OpenRouter structured match".

Optionally use `buildStructuredResponseFormat` from openrouter — **YAGNI:** only change constant unless Kimi match override breaks tests.

- [ ] **Step 2: Run core tests**

```bash
cd packages/core && pnpm exec vitest run -v
```

Expected: all unit tests PASS (integration skipped without env)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/match/ai.ts
git commit -m "feat(core): default match model to Gemini 3.5 Flash"
```

---

### Task 6: Integration tests (Gemini + optional Kimi)

**Files:**
- Modify: `packages/core/src/ai/openrouter-extrato.integration.test.ts`

- [ ] **Step 1: Refactor integration file**

Replace Kimi-only describe with:

```typescript
const GEMINI_MODEL = "google/gemini-3.5-flash";
const KIMI_MODEL = "moonshotai/kimi-k2.6";
const MISTRAL_OCR_PLUGIN = [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }];

describe.runIf(runIntegration)("Gemini extrato (integration)", () => {
  // afterEach env restore (existing)

  it("defaults extrato model to Gemini when OPENROUTER_PDF_MODEL unset", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
    expect(resolveExtratoModel()).toBe(GEMINI_MODEL);
  });

  it.each(BAHIA_PDFS)(
    "extracts transactions from %s with single-call or minimal batching",
    async (filename) => {
      process.env.OPENROUTER_CACHE = "0";
      const buffer = await readFile(path.join(PDF_DIR, filename));
      const { fetch: auditedFetch, pluginsPerCall } = fetchWithPluginAudit(fetch);

      const result = await extractTransactionsFromPdfFile(buffer, {
        filename,
        model: GEMINI_MODEL,
        fetch: auditedFetch,
        timeoutMs: 180_000,
      });

      const visionCalls = pluginsPerCall.filter((p) => p != null);
      expect(visionCalls).toHaveLength(0); // no mistral-ocr

      expect(result.transacoes.length).toBeGreaterThan(0);
      if (filename.includes("PIX")) {
        expect(result.transacoes.length).toBeGreaterThanOrEqual(30);
        const withNome = result.transacoes.filter((t) => String(t.nome ?? "").trim()).length;
        expect(withNome).toBeGreaterThanOrEqual(Math.floor(result.transacoes.length * 0.9));
      }

      const sample = result.transacoes[0]!;
      expect(sample.data).toBeTruthy();
      expect(sample.valor).toBeDefined();
      expect(["ENTRADA", "SAIDA"]).toContain(String(sample.direcao).toUpperCase());
    },
    600_000,
  );
});

describe.runIf(runIntegration && process.env.SPC_TEST_KIMI === "1")(
  "Kimi extrato + mistral-ocr (integration)",
  () => {
    // move existing Kimi tests here unchanged
  },
);
```

- [ ] **Step 2: Run integration (optional, requires API key)**

```bash
cd packages/core && \
  SPC_OPENROUTER_INTEGRATION=1 OPENROUTER_CACHE=0 \
  pnpm exec vitest run --config vitest.integration.config.ts -v
```

Record in PR notes: API call count for PIX (expect 1), transaction counts.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/ai/openrouter-extrato.integration.test.ts
git commit -m "test(core): Gemini default extrato integration suite"
```

---

### Task 7: Env examples and docs

**Files:**
- Modify: `.env.example`
- Modify: `apps/web/.env.example`
- Modify: `docs/superpowers/specs/2026-05-26-documentos-teste-ingestao-descobertas.md` (§6–7)
- Modify: `docs/piloto-checklist.md` (if present)

- [ ] **Step 1: Update `.env.example`**

```bash
# Extrato PDF (visão). Default: google/gemini-3.5-flash (PDF nativo, json_schema)
OPENROUTER_PDF_MODEL=google/gemini-3.5-flash
# Match movimentação ↔ cadastro. Default: google/gemini-3.5-flash
OPENROUTER_MODEL=google/gemini-3.5-flash
# Rollback Kimi: moonshotai/kimi-k2.6 (+ mistral-ocr automático)
```

Remove comment tying PDF default only to Kimi.

- [ ] **Step 2: Mirror `apps/web/.env.example`**

Same two lines and comments.

- [ ] **Step 3: Update descobertas doc**

In §5.2 `shouldBatchPdfVision` table, note:

- Gemini: `pageCount > 1` alone does **not** batch if bytes < 200_000.
- Default model: `google/gemini-3.5-flash`.

Add row to §2 test metrics for Gemini 3.5 Flash (2026-05-27).

- [ ] **Step 4: Commit**

```bash
git add .env.example apps/web/.env.example docs/
git commit -m "docs: Gemini 3.5 Flash as default OpenRouter model"
```

---

### Task 8: Smoke verification (success criteria S1–S4)

**Files:**
- Use: `scripts/test-extrato-model.ts`

- [ ] **Step 1: Run smoke**

```bash
set -a && source .env && set +a
export OPENROUTER_CACHE=0
pnpm exec tsx scripts/test-extrato-model.ts google/gemini-3.5-flash
```

**Record results in PR / issue:**

| PDF | transacoes | apiCalls (manual count or audit script) | ms | with nome |
|-----|------------|----------------------------------------|-----|-----------|

Targets from spec: PIX ≥34 tx, ≤1 API call, ≤25s; TOTAL ≥25 tx, ≥50% with nome/cpf.

- [ ] **Step 2: If S2/S3 fail but S1 passes**

Acceptable to document in descobertas; do not re-enable page batching for Gemini without spec change.

- [ ] **Step 3: Final test suite**

```bash
pnpm --filter @spc-up/core test
```

Expected: PASS

- [ ] **Step 4: Commit smoke notes (optional)**

Only if updating descobertas with measured numbers:

```bash
git add docs/superpowers/specs/2026-05-26-documentos-teste-ingestao-descobertas.md
git commit -m "docs: record Gemini 3.5 Flash smoke metrics"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `model-profile.ts` | Task 1 |
| `gemini_native` batching | Task 2 |
| Gemini default extrato | Task 3 |
| OCR fallback only Kimi | Task 3 |
| Gemini prompt PT | Task 3 |
| Nome heuristic | Task 4 |
| Match default Gemini | Task 5 |
| Integration Gemini + Kimi optional | Task 6 |
| Env / docs | Task 7 |
| S1–S4 smoke | Task 8 |
| Comprovante legado unchanged | Out of scope (no task) |

## Plan self-review

- [x] No TBD / placeholder steps
- [x] Each task has file paths and commands
- [x] Type names consistent (`ModelProfile`, `resolveModelProfile`)
- [x] Fits single implementation cycle
