# Ingestão — erros detalhados e correção PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir modelo OpenRouter do PDF, adicionar logs estruturados de ingestão, mensagens de erro amigáveis na API/UI e aplicar regra B de redirect (falha total bloqueia wizard).

**Architecture:** `classifyIngestError` centraliza códigos e textos em português; `ingestLog` emite JSON por fase; pipeline e `ingestPdfExtrato` logam e gravam `erroMensagem` amigável; rota de upload retorna 422 quando `total_movimentacoes === 0` com erros; hook trata 422 sem redirect.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, `@spc-up/core`, OpenRouter, `pdf-parse`.

**Spec:** [docs/superpowers/specs/2026-05-26-ingestao-erros-pdf-design.md](../specs/2026-05-26-ingestao-erros-pdf-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/ingest/errors.ts` | Códigos, `classifyIngestError`, `IngestError` |
| `packages/core/src/ingest/errors.test.ts` | Mapeamento de mensagens |
| `packages/core/src/ingest/log.ts` | `ingestLog` JSON |
| `packages/core/src/ai/openrouter.ts` | Fix `resolveExtratoModel`; export para testes |
| `packages/core/src/ai/openrouter-extrato.test.ts` | Teste modelo sem Kimi |
| `packages/core/src/ingest/pdf.ts` | Logs por fase; wrap erros |
| `packages/core/src/ingest/pipeline.ts` | `erroMensagem` amigável; logs |
| `packages/core/src/index.ts` | Export `IngestErrorDetail`, helpers |
| `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts` | 422, erros tipados |
| `apps/web/hooks/use-prestacao-submit.ts` | Regra B |
| `apps/web/hooks/use-prestacao-submit.test.ts` | **Novo** — 422 / parcial |
| `apps/web/components/prestacao/submission-progress-panel.tsx` | Lista `erros` |
| `apps/web/components/prestacao/wizard.tsx` | Retry + props |
| `apps/web/.env.example` | Comentário `OPENROUTER_PDF_MODEL` |

---

### Task 1: Erros tipados (`errors.ts`)

**Files:**
- Create: `packages/core/src/ingest/errors.ts`
- Create: `packages/core/src/ingest/errors.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/ingest/errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { classifyIngestError } from "./errors";

describe("classifyIngestError", () => {
  it("maps missing OpenRouter key", () => {
    const r = classifyIngestError(new Error("OPENROUTER_API_KEY is not configured"));
    expect(r.codigo).toBe("OPENROUTER_NAO_CONFIGURADO");
    expect(r.mensagem).toMatch(/não está configurada/i);
  });

  it("maps page limit", () => {
    const r = classifyIngestError(new Error("Extrato com mais de 3 páginas; divida o arquivo"));
    expect(r.codigo).toBe("PDF_MUITAS_PAGINAS");
  });

  it("maps OpenRouter HTTP", () => {
    const r = classifyIngestError(new Error("OpenRouter HTTP 502"));
    expect(r.codigo).toBe("OPENROUTER_FALHA");
  });

  it("maps invalid PDF", () => {
    const r = classifyIngestError(new Error("Invalid PDF structure"));
    expect(r.codigo).toBe("PDF_INVALIDO");
  });

  it("falls back to unknown", () => {
    const r = classifyIngestError(new Error("something weird"));
    expect(r.codigo).toBe("INGESTAO_DESCONHECIDA");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/ingest/errors.test.ts -v
```

- [ ] **Step 3: Implement `errors.ts`**

```typescript
export type IngestErrorCodigo =
  | "OPENROUTER_NAO_CONFIGURADO"
  | "OPENROUTER_FALHA"
  | "PDF_INVALIDO"
  | "PDF_MUITAS_PAGINAS"
  | "PDF_SEM_TEXTO_E_VISAO_FALHOU"
  | "STORAGE_FALHA"
  | "INGESTAO_DESCONHECIDA";

export interface IngestErrorDetail {
  codigo: IngestErrorCodigo;
  mensagem: string;
  causaTecnica: string;
}

const MENSAGENS: Record<IngestErrorCodigo, string> = {
  OPENROUTER_NAO_CONFIGURADO:
    "Extração de PDF não está configurada no servidor. Contate o administrador.",
  OPENROUTER_FALHA:
    "Não foi possível ler o extrato com IA. Tente novamente em alguns minutos.",
  PDF_INVALIDO: "Arquivo PDF inválido ou corrompido.",
  PDF_MUITAS_PAGINAS: "Extrato com mais de 3 páginas. Divida o arquivo.",
  PDF_SEM_TEXTO_E_VISAO_FALHOU:
    "Não foi possível extrair dados deste PDF (scan ou formato não suportado).",
  STORAGE_FALHA: "Falha ao salvar o arquivo. Tente novamente.",
  INGESTAO_DESCONHECIDA: "Erro inesperado no processamento.",
};

export class IngestError extends Error {
  readonly detail: IngestErrorDetail;

  constructor(detail: IngestErrorDetail) {
    super(detail.mensagem);
    this.name = "IngestError";
    this.detail = detail;
  }
}

export function classifyIngestError(error: unknown): IngestErrorDetail {
  const causaTecnica =
    error instanceof Error ? error.message : String(error);
  const msg = causaTecnica.toLowerCase();

  let codigo: IngestErrorCodigo = "INGESTAO_DESCONHECIDA";
  if (causaTecnica.includes("OPENROUTER_API_KEY")) {
    codigo = "OPENROUTER_NAO_CONFIGURADO";
  } else if (/mais de 3 páginas/i.test(causaTecnica)) {
    codigo = "PDF_MUITAS_PAGINAS";
  } else if (/openrouter http/i.test(causaTecnica) || msg.includes("abort")) {
    codigo = "OPENROUTER_FALHA";
  } else if (/invalid pdf/i.test(causaTecnica) || msg.includes("pdf")) {
    codigo = "PDF_INVALIDO";
  }

  return { codigo, mensagem: MENSAGENS[codigo], causaTecnica };
}

export function toIngestError(error: unknown): IngestError {
  if (error instanceof IngestError) return error;
  return new IngestError(classifyIngestError(error));
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm exec vitest run packages/core/src/ingest/errors.test.ts -v
```

---

### Task 2: Logger estruturado

**Files:**
- Create: `packages/core/src/ingest/log.ts`

- [ ] **Step 1: Implement `log.ts`**

```typescript
export type IngestLogLevel = "info" | "error";

export type IngestFase =
  | "inicio"
  | "pdf_text"
  | "openrouter_text"
  | "openrouter_vision"
  | "filtro_doc"
  | "persist"
  | "match"
  | "concluido"
  | "storage";

export interface IngestLogFields {
  fase: IngestFase;
  arquivoId?: string;
  sessaoId?: string;
  filename?: string;
  duracaoMs?: number;
  codigoErro?: string;
  causa?: string;
}

export function ingestLog(level: IngestLogLevel, fields: IngestLogFields): void {
  const line = JSON.stringify({ event: "ingest", level, ...fields });
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}
```

(No unit test required — trivial; covered by integration in pipeline.)

---

### Task 3: Corrigir `resolveExtratoModel`

**Files:**
- Modify: `packages/core/src/ai/openrouter.ts`
- Modify: `packages/core/src/ai/openrouter-extrato.test.ts`

- [ ] **Step 1: Export resolver and add failing test**

In `openrouter.ts`, change:

```typescript
function resolveExtratoModel(options?: ExtractStructuredOptions): string {
```

to exported:

```typescript
export function resolveExtratoModel(options?: ExtractStructuredOptions): string {
  return (
    options?.model ??
    process.env.OPENROUTER_PDF_MODEL ??
    "anthropic/claude-sonnet-4"
  );
}
```

Remove `process.env.OPENROUTER_MODEL` from the chain.

Add to `openrouter-extrato.test.ts`:

```typescript
import { resolveExtratoModel } from "./openrouter";

describe("resolveExtratoModel", () => {
  const prevPdf = process.env.OPENROUTER_PDF_MODEL;
  const prevModel = process.env.OPENROUTER_MODEL;

  afterEach(() => {
    process.env.OPENROUTER_PDF_MODEL = prevPdf;
    process.env.OPENROUTER_MODEL = prevModel;
  });

  it("does not fall back to OPENROUTER_MODEL (Kimi)", () => {
    delete process.env.OPENROUTER_PDF_MODEL;
    process.env.OPENROUTER_MODEL = "moonshotai/kimi-k2.6";
    expect(resolveExtratoModel()).toBe("anthropic/claude-sonnet-4");
  });

  it("uses OPENROUTER_PDF_MODEL when set", () => {
    process.env.OPENROUTER_PDF_MODEL = "google/gemini-2.5-pro";
    expect(resolveExtratoModel()).toBe("google/gemini-2.5-pro");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm exec vitest run packages/core/src/ai/openrouter-extrato.test.ts -v
```

Expected: PASS

---

### Task 4: Instrumentar `ingestPdfExtrato`

**Files:**
- Modify: `packages/core/src/ingest/pdf.ts`

- [ ] **Step 1: Add logs and `toIngestError` on catch paths**

Wrap `ingestPdfExtrato` body:

```typescript
import { ingestLog } from "./log";
import { toIngestError } from "./errors";

// inside ingestPdfExtrato, after resolvePdfBuffer:
const t0 = Date.now();
ingestLog("info", { fase: "inicio", arquivoId, filename });

try {
  ingestLog("info", { fase: "pdf_text", arquivoId, filename });
  const { text, hasEnoughText } = await extractPdfText(buffer);
  ingestLog("info", {
    fase: "pdf_text",
    arquivoId,
    filename,
    duracaoMs: Date.now() - t0,
  });

  const extraction = hasEnoughText
    ? await extractTransactionsFromPdfText(text, { ...options, filename })
    : await extractTransactionsFromPdfFile(buffer, { ...options, filename });

  ingestLog("info", {
    fase: hasEnoughText ? "openrouter_text" : "openrouter_vision",
    arquivoId,
    filename,
  });
  // ... rest unchanged
} catch (error) {
  const ingErr = toIngestError(error);
  ingestLog("error", {
    fase: "pdf_text",
    arquivoId,
    filename,
    codigoErro: ingErr.detail.codigo,
    causa: ingErr.detail.causaTecnica,
  });
  throw ingErr;
}
```

- [ ] **Step 2: Run pdf tests**

```bash
pnpm exec vitest run packages/core/src/ingest/pdf.test.ts -v
```

---

### Task 5: Pipeline — mensagem amigável no DB

**Files:**
- Modify: `packages/core/src/ingest/pipeline.ts`

- [ ] **Step 1: Update catch blocks in `ingestFileBuffer` and `ingestFile`**

```typescript
import { toIngestError } from "./errors";
import { ingestLog } from "./log";

// in catch:
} catch (error) {
  const ingErr = toIngestError(error);
  ingestLog("error", {
    fase: "persist",
    arquivoId: arquivo.id,
    filename: params.filename,
    codigoErro: ingErr.detail.codigo,
    causa: ingErr.detail.causaTecnica,
  });
  await db.update(arquivoIngestao).set({
    status: ARQUIVO_INGESTAO_STATUS.ERRO,
    erroMensagem: ingErr.detail.mensagem,
  }).where(eq(arquivoIngestao.id, arquivo.id));
  throw ingErr;
}
```

- [ ] **Step 2: Run core tests**

```bash
pnpm --filter @spc-up/core test
```

---

### Task 6: API upload — 422 e erros tipados

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`

- [ ] **Step 1: Change error shape and status**

```typescript
import { classifyIngestError } from "@spc-up/core";

type UploadErro = { nome: string; codigo: string; mensagem: string };
const errors: UploadErro[] = [];

// on blob failure:
const detail = classifyIngestError(error);
errors.push({ nome: file.name, codigo: detail.codigo, mensagem: detail.mensagem });

// on ingest catch:
const detail = classifyIngestError(error);
errors.push({ nome: file.name, codigo: detail.codigo, mensagem: detail.mensagem });

// before return:
const total = results.reduce((s, r) => s + r.movimentacoes_criadas, 0);
const payload = { arquivos: results, erros: errors, total_movimentacoes: total };

if (total === 0 && errors.length > 0 && files.length > 0) {
  return NextResponse.json(
    { error: "Nenhum arquivo foi processado com sucesso.", ...payload },
    { status: 422 },
  );
}
return NextResponse.json(payload);
```

Export `classifyIngestError` from `packages/core/src/index.ts` if not already.

- [ ] **Step 2: Manual check**

```bash
pnpm --filter web lint
```

---

### Task 7: Hook — regra B

**Files:**
- Modify: `apps/web/hooks/use-prestacao-submit.ts`
- Create: `apps/web/hooks/use-prestacao-submit.test.ts`

- [ ] **Step 1: Write failing test for 422**

```typescript
import { describe, expect, it } from "vitest";

// Extract pure helper for testability:
export function shouldBlockRedirect(
  status: number,
  totalMovimentacoes: number,
  errosCount: number,
): boolean {
  if (status === 422) return true;
  return totalMovimentacoes === 0 && errosCount > 0;
}

describe("shouldBlockRedirect", () => {
  it("blocks on 422", () => {
    expect(shouldBlockRedirect(422, 0, 1)).toBe(true);
  });
  it("blocks when zero movements and errors", () => {
    expect(shouldBlockRedirect(200, 0, 2)).toBe(true);
  });
  it("allows partial success", () => {
    expect(shouldBlockRedirect(200, 3, 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Integrate in `submit`**

After parsing `upJson`:

```typescript
type UploadErro = { nome: string; codigo: string; mensagem: string };
const erros = (upJson.erros ?? []) as UploadErro[];
const total = upJson.total_movimentacoes ?? 0;

if (shouldBlockRedirect(status, total, erros.length)) {
  const msg =
    erros.map((e) => `${e.nome}: ${e.mensagem}`).join(" · ") ||
    upJson.error ||
    "Nenhum arquivo foi processado.";
  // set phase error, steps error, throw
}
```

Extend `buildUploadWarning` to use `e.mensagem` instead of raw strings.

- [ ] **Step 3: Run test**

```bash
pnpm exec vitest run apps/web/hooks/use-prestacao-submit.test.ts -v
```

---

### Task 8: UI — painel e wizard

**Files:**
- Modify: `apps/web/components/prestacao/submission-progress-panel.tsx`
- Modify: `apps/web/components/prestacao/wizard.tsx`

- [ ] **Step 1: Add `fileErrors` prop to panel**

```typescript
fileErrors?: Array<{ nome: string; mensagem: string }>;
```

Render list with `role="alert"` when `fileErrors.length > 0`.

- [ ] **Step 2: Wire wizard**

Pass `fileErrors` from hook state (`fileErrors` new state set on error).
Add button when `phase === "error"`:

```tsx
<Button type="button" variant="outline" onClick={() => reset()}>
  Tentar novamente
</Button>
```

Expose `reset` and `fileErrors` from `usePrestacaoSubmit`.

---

### Task 9: Docs env e exports

**Files:**
- Modify: `apps/web/.env.example`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Clarify env comment**

```env
# Model for PDF extrato only (defaults to anthropic/claude-sonnet-4).
# OPENROUTER_MODEL is NOT used for PDF extraction.
OPENROUTER_PDF_MODEL=
```

- [ ] **Step 2: Export from core index**

```typescript
export {
  classifyIngestError,
  toIngestError,
  type IngestErrorDetail,
  type IngestErrorCodigo,
} from "./ingest/errors";
```

---

### Task 10: Verificação final

- [ ] **Run core tests**

```bash
pnpm --filter @spc-up/core test
```

- [ ] **Run web hook test**

```bash
pnpm exec vitest run apps/web/hooks/use-prestacao-submit.test.ts -v
```

- [ ] **Smoke: upload PDF** (dev server) — confirm logs JSON in terminal and friendly message on missing key / bad file.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Fix PDF model fallback | Task 3 |
| Structured logs | Task 2, 4, 5, 6 |
| Error codes + PT messages | Task 1 |
| API 422 total failure | Task 6 |
| UI rule B | Task 7, 8 |
| Tests | Tasks 1, 3, 7, 10 |
