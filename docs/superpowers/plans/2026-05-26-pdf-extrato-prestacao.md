# Extração de extrato bancário (PDF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingestão de extratos PDF na prestação com múltiplas movimentações, extração híbrida (texto local + fallback OpenRouter), e persistência apenas de linhas com CPF ou CNPJ válido.

**Architecture:** `pdf-parse` extrai texto; se ≥200 caracteres, OpenRouter estrutura `transacoes[]` a partir do texto; senão, OpenRouter lê o PDF em base64. `ingestPdfExtrato` filtra com `normalizeCpf`/`normalizeCnpj`, persiste via `persistTransactions`, aplica match Kimi por linha. Upload de sessão permanece síncrono (1–3 páginas).

**Tech Stack:** TypeScript, `pdf-parse`, OpenRouter API, Vitest, Next.js App Router, `@spc-up/core`, `@spc-up/db`.

**Spec:** [docs/superpowers/specs/2026-05-26-pdf-extrato-prestacao-design.md](../specs/2026-05-26-pdf-extrato-prestacao-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/package.json` | Dep `pdf-parse` |
| `packages/core/src/ingest/pdf-text.ts` | `extractPdfText`, limites `MIN_TEXT_CHARS` / `MAX_PAGES` |
| `packages/core/src/ingest/pdf-text.test.ts` | Mock `pdf-parse` |
| `packages/core/src/ai/openrouter.ts` | `extractTransactionsFromPdfText`, `extractTransactionsFromPdfFile`; schema array |
| `packages/core/src/ai/openrouter-extrato.test.ts` | Mocks fetch; ramos texto vs arquivo |
| `packages/core/src/ingest/pdf.ts` | `rowsFromExtratoTransactions`, `ingestPdfExtrato`, `IngestPdfExtratoResult` |
| `packages/core/src/ingest/pdf.test.ts` | Regra B + orquestração |
| `packages/core/src/ingest/pipeline.ts` | `.pdf` → `ingestPdfExtrato`; retorno estendido |
| `packages/core/src/index.ts` | Export novos símbolos |
| `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts` | JSON com contadores |
| `apps/web/components/prestacao/wizard.tsx` | Mensagem pós-upload |

---

### Task 1: Dependência e extração de texto local

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/ingest/pdf-text.ts`
- Create: `packages/core/src/ingest/pdf-text.test.ts`

- [ ] **Step 1: Add dependency**

In `packages/core/package.json` dependencies:

```json
"pdf-parse": "^1.1.1"
```

Run from repo root:

```bash
pnpm install
```

- [ ] **Step 2: Write failing test for `extractPdfText`**

Create `packages/core/src/ingest/pdf-text.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));

import pdfParse from "pdf-parse";
import { extractPdfText, MAX_EXTRATO_PAGES, MIN_TEXT_CHARS } from "./pdf-text";

describe("extractPdfText", () => {
  it("returns trimmed text and page count", async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: "  LINHA 1\nLINHA 2  ",
      numpages: 2,
    } as never);

    const result = await extractPdfText(Buffer.from("fake"));
    expect(result.text).toBe("LINHA 1\nLINHA 2");
    expect(result.numpages).toBe(2);
    expect(result.hasEnoughText).toBe(true);
  });

  it("flags low text for vision fallback", async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: "x",
      numpages: 1,
    } as never);

    const result = await extractPdfText(Buffer.from("fake"));
    expect(result.hasEnoughText).toBe(false);
    expect(result.text.length).toBeLessThan(MIN_TEXT_CHARS);
  });

  it("rejects more than MAX_EXTRATO_PAGES", async () => {
    vi.mocked(pdfParse).mockResolvedValue({
      text: "a".repeat(MIN_TEXT_CHARS),
      numpages: MAX_EXTRATO_PAGES + 1,
    } as never);

    await expect(extractPdfText(Buffer.from("fake"))).rejects.toThrow(
      /mais de 3 páginas/i,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm exec vitest run packages/core/src/ingest/pdf-text.test.ts -v
```

Expected: FAIL — module `./pdf-text` not found.

- [ ] **Step 4: Implement `pdf-text.ts`**

Create `packages/core/src/ingest/pdf-text.ts`:

```typescript
import pdfParse from "pdf-parse";

export const MIN_TEXT_CHARS = 200;
export const MAX_EXTRATO_PAGES = 3;

export interface PdfTextExtraction {
  text: string;
  numpages: number;
  hasEnoughText: boolean;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfTextExtraction> {
  const parsed = await pdfParse(buffer);
  const numpages = parsed.numpages ?? 0;
  if (numpages > MAX_EXTRATO_PAGES) {
    throw new Error(
      `Extrato com mais de ${MAX_EXTRATO_PAGES} páginas; divida o arquivo ou use a CLI.`,
    );
  }
  const text = (parsed.text ?? "").trim();
  return {
    text,
    numpages,
    hasEnoughText: text.length >= MIN_TEXT_CHARS,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm exec vitest run packages/core/src/ingest/pdf-text.test.ts -v
```

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/ingest/pdf-text.ts packages/core/src/ingest/pdf-text.test.ts
git commit -m "feat(core): add pdf-parse text extraction for extrato"
```

---

### Task 2: OpenRouter — schema `transacoes[]` (texto e PDF)

**Files:**
- Modify: `packages/core/src/ai/openrouter.ts`
- Create: `packages/core/src/ai/openrouter-extrato.test.ts`

- [ ] **Step 1: Write failing test — text path**

Create `packages/core/src/ai/openrouter-extrato.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import {
  extractTransactionsFromPdfText,
  extractTransactionsFromPdfFile,
} from "./openrouter";

const SAMPLE = {
  transacoes: [
    {
      data: "2025-03-15",
      valor: 100.5,
      direcao: "ENTRADA",
      descricao: "PIX Joao",
      cpf: "39053344705",
    },
    {
      data: "2025-03-16",
      valor: 50,
      direcao: "SAIDA",
      descricao: "TARIFA",
    },
  ],
};

function mockFetch(payload: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(payload) } }],
    }),
  });
}

describe("extractTransactionsFromPdfText", () => {
  it("returns transacoes array from OpenRouter", async () => {
    const fetchFn = mockFetch(SAMPLE);
    const result = await extractTransactionsFromPdfText("extrato linha 1\nlinha 2", {
      fetch: fetchFn,
      apiKey: "test-key",
      model: "test-model",
    });
    expect(result.transacoes).toHaveLength(2);
    expect(fetchFn).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content[0].type).toBe("text");
    expect(body.messages[1].content[0].text).toContain("extrato linha");
  });
});

describe("extractTransactionsFromPdfFile", () => {
  it("sends file attachment for vision path", async () => {
    const fetchFn = mockFetch(SAMPLE);
    await extractTransactionsFromPdfFile(Buffer.from("%PDF"), {
      fetch: fetchFn,
      apiKey: "test-key",
      model: "test-model",
      filename: "extrato.pdf",
    });
    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body));
    expect(body.messages[1].content.some((p: { type: string }) => p.type === "file")).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/ai/openrouter-extrato.test.ts -v
```

- [ ] **Step 3: Implement extrato helpers in `openrouter.ts`**

Add shared schema and exports (keep `extractStructuredFromPdf` for backward compat):

```typescript
const EXTRATO_TRANSACTION_ITEM_SCHEMA = {
  type: "object",
  properties: {
    data: { type: "string", description: "YYYY-MM-DD" },
    valor: { type: "number" },
    direcao: { type: "string", enum: ["ENTRADA", "SAIDA"] },
    descricao: { type: "string" },
    cpf: { type: "string" },
    cnpj: { type: "string" },
    nome: { type: "string" },
  },
  required: ["data", "valor", "direcao", "descricao"],
  additionalProperties: false,
} as const;

const EXTRATO_ARRAY_SCHEMA = {
  type: "object",
  properties: {
    transacoes: {
      type: "array",
      items: EXTRATO_TRANSACTION_ITEM_SCHEMA,
    },
  },
  required: ["transacoes"],
  additionalProperties: false,
} as const;

const EXTRATO_SYSTEM_PROMPT =
  "You extract all bank transaction lines from Brazilian bank statement text or PDF. " +
  "Ignore opening balance, closing balance, and header/footer repeats. " +
  "Return ENTRADA for credits and SAIDA for debits. Include cpf/cnpj only when visible.";

export interface ExtratoExtraction {
  transacoes: Array<Record<string, unknown>>;
}

export async function extractTransactionsFromPdfText(
  statementText: string,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const parsed = await callOpenRouterJson(
    buildExtratoTextPayload(statementText, options?.model),
    options,
  );
  return normalizeExtratoResponse(parsed);
}

export async function extractTransactionsFromPdfFile(
  buffer: Buffer,
  options?: ExtractStructuredOptions,
): Promise<ExtratoExtraction> {
  const filename = options?.filename ?? "extrato.pdf";
  const parsed = await callOpenRouterJson(
    buildExtratoFilePayload(buffer, filename, options?.model),
    options,
  );
  return normalizeExtratoResponse(parsed);
}
```

Refactor existing `extractStructuredFromPdf` to reuse internal `callOpenRouterJson` + `parseResponseBody` (extract private helper if needed). `normalizeExtratoResponse` validates `transacoes` is array.

`buildExtratoTextPayload`: user message is text-only (no file). `buildExtratoFilePayload`: same as current file block + extrato prompt.

Model resolution: `options?.model ?? process.env.OPENROUTER_PDF_MODEL ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4"`.

- [ ] **Step 4: Run tests**

```bash
pnpm exec vitest run packages/core/src/ai/openrouter-extrato.test.ts packages/core/src/ai/openrouter.test.ts -v
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai/openrouter.ts packages/core/src/ai/openrouter-extrato.test.ts
git commit -m "feat(core): openrouter extrato array extraction"
```

---

### Task 3: `ingestPdfExtrato` + regra B

**Files:**
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/ingest/pdf.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `pdf.test.ts` (new mocks):

```typescript
vi.mock("./pdf-text", () => ({
  extractPdfText: vi.fn(),
  MIN_TEXT_CHARS: 200,
}));

vi.mock("../ai/openrouter", () => ({
  extractStructuredFromPdf: vi.fn(),
  extractTransactionsFromPdfText: vi.fn(),
  extractTransactionsFromPdfFile: vi.fn(),
}));

import { extractPdfText } from "./pdf-text";
import {
  extractTransactionsFromPdfText,
  extractTransactionsFromPdfFile,
} from "../ai/openrouter";
import { ingestPdfExtrato, rowsFromExtratoTransactions } from "./pdf";

const VALID_CPF = "39053344705";

describe("rowsFromExtratoTransactions", () => {
  it("keeps rows with valid CPF and skips others", () => {
    const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions({
      transacoes: [
        {
          data: "2025-03-15",
          valor: 10,
          direcao: "ENTRADA",
          descricao: "PIX",
          cpf: VALID_CPF,
        },
        {
          data: "2025-03-16",
          valor: 5,
          direcao: "SAIDA",
          descricao: "TARIFA",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(linhasIgnoradasSemDoc).toBe(1);
    expect(rows[0]?.descricaoRaw).toContain(VALID_CPF);
  });
});

describe("ingestPdfExtrato", () => {
  it("uses text path when pdf has enough text", async () => {
    vi.mocked(extractPdfText).mockResolvedValue({
      text: "x".repeat(250),
      numpages: 1,
      hasEnoughText: true,
    });
    vi.mocked(extractTransactionsFromPdfText).mockResolvedValue({
      transacoes: [
        {
          data: "2025-03-15",
          valor: 10,
          direcao: "ENTRADA",
          descricao: "PIX",
          cpf: VALID_CPF,
        },
      ],
    });
    vi.mocked(persistTransactions).mockResolvedValue([{ id: "m1" }] as never);
    vi.mocked(applyAiMatchToMovimentacao).mockImplementation(async (_db, id) => ({ id }) as never);

    const result = await ingestPdfExtrato(
      {} as never,
      "SP",
      2025,
      "arq-1",
      Buffer.from("pdf"),
      PRESTADOR_SP,
    );

    expect(extractTransactionsFromPdfText).toHaveBeenCalled();
    expect(extractTransactionsFromPdfFile).not.toHaveBeenCalled();
    expect(result.movimentacoes).toHaveLength(1);
    expect(result.linhasIgnoradasSemDoc).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/ingest/pdf.test.ts -v
```

- [ ] **Step 3: Implement in `pdf.ts`**

```typescript
import { extractPdfText } from "./pdf-text";
import {
  extractTransactionsFromPdfFile,
  extractTransactionsFromPdfText,
  type ExtratoExtraction,
} from "../ai/openrouter";
import { normalizeCpf, normalizeCnpj } from "../normalize";

export interface IngestPdfExtratoResult {
  movimentacoes: Movimentacao[];
  linhasIgnoradasSemDoc: number;
}

export function rowsFromExtratoTransactions(extraction: ExtratoExtraction): {
  rows: ParsedTransactionRow[];
  linhasIgnoradasSemDoc: number;
} {
  let linhasIgnoradasSemDoc = 0;
  const rows: ParsedTransactionRow[] = [];

  for (const item of extraction.transacoes) {
    let docLabel: string | null = null;
    try {
      if (item.cpf != null && String(item.cpf).trim()) {
        docLabel = `CPF ${normalizeCpf(String(item.cpf))}`;
      }
    } catch {
      /* try cnpj */
    }
    if (!docLabel) {
      try {
        if (item.cnpj != null && String(item.cnpj).trim()) {
          docLabel = `CNPJ ${normalizeCnpj(String(item.cnpj))}`;
        }
      } catch {
        /* skip */
      }
    }
    if (!docLabel) {
      linhasIgnoradasSemDoc += 1;
      continue;
    }

    const base = rowFromExtraction({
      cpf: "00000000000",
      nome: String(item.nome ?? "").trim() || String(item.descricao).trim(),
      valor: item.valor,
      data: item.data,
      direcao: item.direcao,
    });
    rows.push({
      ...base,
      descricaoRaw: [base.descricaoRaw, docLabel].filter(Boolean).join(" | "),
    });
  }

  return { rows, linhasIgnoradasSemDoc };
}

export async function ingestPdfExtrato(
  db: Db,
  uf: string,
  exercicio: number,
  arquivoId: string,
  pathOrBuffer: string | Buffer,
  prestador: PrestadorContext,
  options?: { filename?: string },
): Promise<IngestPdfExtratoResult> {
  const buffer = Buffer.isBuffer(pathOrBuffer)
    ? pathOrBuffer
    : await readFile(pathOrBuffer);

  const { hasEnoughText, text } = await extractPdfText(buffer);
  const extraction = hasEnoughText
    ? await extractTransactionsFromPdfText(text, {
        filename: options?.filename,
      })
    : await extractTransactionsFromPdfFile(buffer, {
        filename: options?.filename ?? "extrato.pdf",
      });

  const { rows, linhasIgnoradasSemDoc } = rowsFromExtratoTransactions(extraction);
  if (rows.length === 0) {
    return { movimentacoes: [], linhasIgnoradasSemDoc };
  }

  const created = await persistTransactions(db, uf, exercicio, arquivoId, rows, prestador);
  const movimentacoes: Movimentacao[] = [];
  for (const movimentacao of created) {
    movimentacoes.push(await applyAiMatchToMovimentacao(db, movimentacao.id));
  }
  return { movimentacoes, linhasIgnoradasSemDoc };
}
```

Keep `ingestPdf` delegating to single-item flow OR mark deprecated — pipeline will call only `ingestPdfExtrato`.

Adjust `rowFromExtraction` usage: for extrato rows, `cpf` placeholder in `rowFromExtraction` is awkward; prefer small helper `rowFromExtratoItem` that maps date/valor/direcao/descricao without fake cpf (cleaner than passing `00000000000`).

**Preferred:** add `rowFromExtratoItem(item, docLabel)` building `ParsedTransactionRow` directly (no invalid CPF in descricao base).

- [ ] **Step 4: Run tests**

```bash
pnpm exec vitest run packages/core/src/ingest/pdf.test.ts -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/pdf.ts packages/core/src/ingest/pdf.test.ts
git commit -m "feat(core): ingestPdfExtrato with CPF/CNPJ filter"
```

---

### Task 4: Pipeline + tipos de retorno

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Extend `IngestBufferResult`**

In `pipeline.ts` (or types file if exists):

```typescript
export interface IngestBufferResult {
  movimentacoes_criadas: number;
  ids: string[];
  linhas_ignoradas_sem_doc?: number;
}
```

- [ ] **Step 2: Switch PDF branch**

Replace:

```typescript
const matched = await ingestPdf(...)
```

With:

```typescript
const { movimentacoes, linhasIgnoradasSemDoc } = await ingestPdfExtrato(
  db,
  uf,
  params.exercicio,
  arquivo.id,
  params.buffer,
  prestador,
  { filename: params.filename },
);
matchedIds = movimentacoes.map((m) => m.id);
// accumulate linhasIgnoradasSemDoc for return
```

Return `linhas_ignoradas_sem_doc` when suffix is `.pdf`.

- [ ] **Step 3: Export from `index.ts`**

```typescript
export {
  ingestPdf,
  ingestPdfExtrato,
  rowFromExtraction,
  rowsFromExtratoTransactions,
  type IngestPdfExtratoResult,
} from "./ingest/pdf";
export {
  extractTransactionsFromPdfText,
  extractTransactionsFromPdfFile,
  type ExtratoExtraction,
} from "./ai/openrouter";
export { extractPdfText, MIN_TEXT_CHARS, MAX_EXTRATO_PAGES } from "./ingest/pdf-text";
```

- [ ] **Step 4: Run core tests**

```bash
pnpm exec vitest run packages/core -v
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/pipeline.ts packages/core/src/index.ts
git commit -m "feat(core): wire extrato PDF ingest in pipeline"
```

---

### Task 5: API upload + wizard feedback

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`
- Modify: `apps/web/components/prestacao/wizard.tsx`

- [ ] **Step 1: Extend upload route result type**

```typescript
const results: Array<{
  nome: string;
  movimentacoes_criadas: number;
  linhas_ignoradas_sem_doc?: number;
}> = [];

// inside loop after ingestFileBuffer:
results.push({
  nome: file.name,
  movimentacoes_criadas: result.movimentacoes_criadas,
  ...(result.linhas_ignoradas_sem_doc != null && result.linhas_ignoradas_sem_doc > 0
    ? { linhas_ignoradas_sem_doc: result.linhas_ignoradas_sem_doc }
    : {}),
});
```

- [ ] **Step 2: Wizard success message**

After successful upload (before `router.push`), if `upJson.arquivos` present:

```typescript
const summaries = (upJson.arquivos ?? []).map(
  (a: { nome: string; movimentacoes_criadas: number; linhas_ignoradas_sem_doc?: number }) => {
    const base = `${a.nome}: ${a.movimentacoes_criadas} movimentação(ões)`;
  const skip =
    a.linhas_ignoradas_sem_doc && a.linhas_ignoradas_sem_doc > 0
      ? `; ${a.linhas_ignoradas_sem_doc} linha(s) sem CPF/CNPJ válido`
      : "";
  return base + skip;
},
);
if (summaries.length) {
  setMessage(summaries.join(" · "));
}
```

Optional: 2s delay before navigate so user reads message, or keep navigate + show on kanban — **default:** set message and still navigate (message may flash); better: pass `?upload=ok` query — **YAGNI:** set message only when `movimentacoes_criadas === 0` or `linhas_ignoradas_sem_doc > 0`, else navigate silently.

- [ ] **Step 3: Manual smoke**

```bash
pnpm --filter web dev
```

Upload sample extrato PDF on wizard step 5 with `OPENROUTER_API_KEY` set.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts apps/web/components/prestacao/wizard.tsx
git commit -m "feat(web): show extrato ingest counters on upload"
```

---

### Task 6: Documentação operacional

**Files:**
- Modify: `apps/web/.env.example`
- Modify: `docs/piloto-checklist.md` (one bullet)

- [ ] **Step 1: Add env hint**

```
# Optional: model for PDF extrato extraction (defaults to claude-sonnet-4)
OPENROUTER_PDF_MODEL=
```

- [ ] **Step 2: Checklist bullet**

"Extrato PDF: 1–3 páginas; linhas sem CPF/CNPJ no extrato não viram movimentação."

- [ ] **Step 3: Commit**

```bash
git add apps/web/.env.example docs/piloto-checklist.md
git commit -m "docs: extrato PDF pilot limits and env"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Híbrido texto/visão | 1, 2, 3 |
| MAX 3 páginas | 1 |
| Array `transacoes` | 2 |
| Regra B CPF/CNPJ | 3 |
| Sync upload | 4, 5 (no Workflow) |
| API counters | 4, 5 |
| Wizard feedback | 5 |
| Tests | 1–4 |
| `OPENROUTER_PDF_MODEL` | 2, 6 |

No TBD placeholders in task steps.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-05-26-pdf-extrato-prestacao.md`.

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  

**2. Inline Execution** — same session, `executing-plans`, checkpoints  

Which approach?
