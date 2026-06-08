# Mapeamento de colunas de extrato (PDF) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passo obrigatório no wizard para o operador mapear colunas do extrato PDF por clique na prévia; o mapa orienta a extração por IA e não persiste em movimentação/export.

**Architecture:** Estado do mapa no cliente (`File` → `ExtratoColumnMap`); `buildExtratoColumnPromptHint()` em `@spc-up/core` injeta texto nos payloads OpenRouter; `processarPaginaPdfExtrato` recebe o mapa via `ExtractStructuredOptions.extratoColumnMap` repassado pela API `POST .../processar`.

**Tech Stack:** TypeScript, Vitest, Next.js App Router, `pdfjs-dist` 4.10.38 (já em `apps/web`), `@spc-up/core`, `@spc-up/db`.

**Spec:** [docs/superpowers/specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md](../specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/ingest/extrato-column-map.ts` | Tipos, `parseExtratoColumnMap`, `validateExtratoColumnMap`, `buildExtratoColumnPromptHint` |
| `packages/core/src/ingest/extrato-column-map.test.ts` | Validação + snapshot do hint |
| `packages/core/src/ai/openrouter-types.ts` | `extratoColumnMap?: ExtratoColumnMap` em `ExtractStructuredOptions` |
| `packages/core/src/ai/openrouter/schemas.ts` | `appendExtratoColumnHint(messages, map)` usado pelos `buildExtrato*Payload` |
| `packages/core/src/ingest/pdf-pagina.ts` | Repassa `options.extratoColumnMap` (já via `ExtractStructuredOptions`) |
| `packages/core/src/index.ts` | Export tipos + funções |
| `apps/web/lib/extrato-column-map-client.ts` | `clientFileKey`, resolução de clique → `colunaIndex` |
| `apps/web/hooks/use-extrato-column-map.ts` | Estado por arquivo, validação UI |
| `apps/web/components/prestacao/extrato-column-map-panel.tsx` | Prévia pdf.js + lista de campos |
| `apps/web/components/prestacao/prestacao-flow-steps.ts` | Etapa 6; renumerar end-to-end 7–8 |
| `apps/web/components/prestacao/wizard.tsx` | Passo 6; bloquear submit |
| `apps/web/hooks/use-prestacao-submit.ts` | Aceitar `extratoColumnMaps`; enviar no `processar` |
| `apps/web/lib/pagina-pdf-route.ts` | Parse `extratoColumnMap` do body JSON |

---

### Task 1: Tipos e hint de prompt (`@spc-up/core`)

**Files:**
- Create: `packages/core/src/ingest/extrato-column-map.ts`
- Create: `packages/core/src/ingest/extrato-column-map.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/ingest/extrato-column-map.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  buildExtratoColumnPromptHint,
  parseExtratoColumnMap,
  validateExtratoColumnMap,
} from "./extrato-column-map";

describe("validateExtratoColumnMap", () => {
  const base = {
    paginaReferencia: 1 as const,
    colunas: [
      { campo: "data", colunaIndex: 0 },
      { campo: "valor", colunaIndex: 1 },
      { campo: "documento", colunaIndex: 2 },
    ],
  };

  it("accepts data+valor+documento", () => {
    expect(validateExtratoColumnMap(base).ok).toBe(true);
  });

  it("accepts data+valor+nome+historico without documento", () => {
    expect(
      validateExtratoColumnMap({
        paginaReferencia: 1,
        colunas: [
          { campo: "data", colunaIndex: 0 },
          { campo: "valor", colunaIndex: 1 },
          { campo: "nome", colunaIndex: 2 },
          { campo: "historico", colunaIndex: 3 },
        ],
      }).ok,
    ).toBe(true);
  });

  it("rejects missing data", () => {
    const r = validateExtratoColumnMap({
      paginaReferencia: 1,
      colunas: [{ campo: "valor", colunaIndex: 0 }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("buildExtratoColumnPromptHint", () => {
  it("includes custom field labels", () => {
    const hint = buildExtratoColumnPromptHint({
      paginaReferencia: 1,
      inferirDirecaoDoValor: true,
      colunas: [
        { campo: "data", colunaIndex: 0, headerLabel: "Data" },
        { campo: "custom_nro", colunaIndex: 4, label: "Nº doc." },
      ],
    });
    expect(hint).toContain("coluna 0 = data");
    expect(hint).toContain("Nº doc.");
    expect(hint).toContain("inferir");
  });
});

describe("parseExtratoColumnMap", () => {
  it("parses valid JSON", () => {
    const m = parseExtratoColumnMap({
      paginaReferencia: 1,
      colunas: [{ campo: "data", colunaIndex: 0 }],
    });
    expect(m?.colunas).toHaveLength(1);
  });

  it("returns null for invalid", () => {
    expect(parseExtratoColumnMap(null)).toBeNull();
    expect(parseExtratoColumnMap({ paginaReferencia: 2 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec vitest run packages/core/src/ingest/extrato-column-map.test.ts -v
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extrato-column-map.ts`**

```typescript
export type ExtratoColumnMapEntry = {
  campo: string;
  label?: string;
  colunaIndex: number;
  headerLabel?: string;
  xInicio?: number;
  xFim?: number;
};

export type ExtratoColumnMap = {
  paginaReferencia: 1;
  inferirDirecaoDoValor?: boolean;
  colunas: ExtratoColumnMapEntry[];
};

const PADRAO = new Set([
  "data",
  "valor",
  "direcao",
  "documento",
  "nome",
  "historico",
  "cred_dev",
  "hora",
]);

function hasCampo(map: ExtratoColumnMap, campo: string): boolean {
  return map.colunas.some((c) => c.campo === campo);
}

export function validateExtratoColumnMap(
  map: ExtratoColumnMap,
): { ok: true } | { ok: false; message: string } {
  if (map.paginaReferencia !== 1) {
    return { ok: false, message: "paginaReferencia deve ser 1" };
  }
  if (!hasCampo(map, "data")) {
    return { ok: false, message: "Mapeie a coluna data" };
  }
  if (!hasCampo(map, "valor")) {
    return { ok: false, message: "Mapeie a coluna valor" };
  }
  const temDirecao = hasCampo(map, "direcao") || map.inferirDirecaoDoValor === true;
  if (!temDirecao) {
    return { ok: false, message: "Mapeie direcao ou marque inferir do valor" };
  }
  const temDoc = hasCampo(map, "documento");
  const temNomeHist = hasCampo(map, "nome") && hasCampo(map, "historico");
  if (!temDoc && !temNomeHist) {
    return {
      ok: false,
      message: "Mapeie documento ou nome e historico",
    };
  }
  for (const col of map.colunas) {
    if (!Number.isInteger(col.colunaIndex) || col.colunaIndex < 0) {
      return { ok: false, message: `colunaIndex inválido para ${col.campo}` };
    }
  }
  return { ok: true };
}

export function parseExtratoColumnMap(raw: unknown): ExtratoColumnMap | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.paginaReferencia !== 1) return null;
  if (!Array.isArray(o.colunas)) return null;
  const colunas: ExtratoColumnMapEntry[] = [];
  for (const item of o.colunas) {
    if (item == null || typeof item !== "object") return null;
    const e = item as Record<string, unknown>;
    const campo = String(e.campo ?? "").trim();
    if (!campo) return null;
    const colunaIndex = Number(e.colunaIndex);
    if (!Number.isInteger(colunaIndex) || colunaIndex < 0) return null;
    colunas.push({
      campo,
      label: e.label != null ? String(e.label) : undefined,
      colunaIndex,
      headerLabel: e.headerLabel != null ? String(e.headerLabel) : undefined,
      xInicio: typeof e.xInicio === "number" ? e.xInicio : undefined,
      xFim: typeof e.xFim === "number" ? e.xFim : undefined,
    });
  }
  const map: ExtratoColumnMap = {
    paginaReferencia: 1,
    inferirDirecaoDoValor: o.inferirDirecaoDoValor === true,
    colunas,
  };
  return validateExtratoColumnMap(map).ok ? map : null;
}

function labelFor(entry: ExtratoColumnMapEntry): string {
  if (entry.label?.trim()) return entry.label.trim();
  if (entry.headerLabel?.trim()) return entry.headerLabel.trim();
  return entry.campo;
}

export function buildExtratoColumnPromptHint(map: ExtratoColumnMap): string {
  const lines = map.colunas
    .slice()
    .sort((a, b) => a.colunaIndex - b.colunaIndex)
    .map(
      (c) =>
        `coluna ${c.colunaIndex} = ${c.campo}` +
        (c.headerLabel ? ` (rótulo "${c.headerLabel}")` : "") +
        (c.label && c.label !== c.campo ? ` — "${labelFor(c)}"` : ""),
    );
  const direcao =
    map.inferirDirecaoDoValor === true
      ? "Direção ENTRADA/SAIDA: inferir pelo sinal ou natureza da coluna valor."
      : hasCampo(map, "direcao")
        ? "Use a coluna mapeada como direcao."
        : "";
  return (
    "Layout de colunas informado pelo operador (índice 0 = esquerda). " +
    "Aplique em todas as páginas deste extrato:\n" +
    lines.join("\n") +
    (direcao ? `\n${direcao}` : "")
  );
}

export function slugCustomField(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `custom_${base || "campo"}`;
}

export { PADRAO as EXTRATO_COLUMN_MAP_CAMPOS_PADRAO };
```

Export from `packages/core/src/index.ts`:

```typescript
export {
  buildExtratoColumnPromptHint,
  parseExtratoColumnMap,
  validateExtratoColumnMap,
  slugCustomField,
  EXTRATO_COLUMN_MAP_CAMPOS_PADRAO,
  type ExtratoColumnMap,
  type ExtratoColumnMapEntry,
} from "./ingest/extrato-column-map";
```

- [ ] **Step 4: Run tests**

```bash
pnpm exec vitest run packages/core/src/ingest/extrato-column-map.test.ts -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/extrato-column-map.ts packages/core/src/ingest/extrato-column-map.test.ts packages/core/src/index.ts
git commit -m "feat(core): extrato column map types and prompt hint"
```

---

### Task 2: Injetar hint nos payloads OpenRouter

**Files:**
- Modify: `packages/core/src/ai/openrouter-types.ts`
- Modify: `packages/core/src/ai/openrouter/schemas.ts`
- Create: `packages/core/src/ai/openrouter/extrato-column-hint.test.ts`

- [ ] **Step 1: Extend `ExtractStructuredOptions`**

In `packages/core/src/ai/openrouter-types.ts`:

```typescript
import type { ExtratoColumnMap } from "../ingest/extrato-column-map";

export interface ExtractStructuredOptions {
  // ...existing fields...
  extratoColumnMap?: ExtratoColumnMap;
}
```

- [ ] **Step 2: Write failing test for hint injection**

Create `packages/core/src/ai/openrouter/extrato-column-hint.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildExtratoTextPayload } from "../schemas";

describe("buildExtratoTextPayload column hint", () => {
  it("appends operator column map to user message", () => {
    const payload = buildExtratoTextPayload("linha1", "google/gemini-2.5-flash", {
      extratoColumnMap: {
        paginaReferencia: 1,
        colunas: [{ campo: "data", colunaIndex: 0 }],
      },
    });
    const messages = (payload as { messages: { role: string; content: string }[] }).messages;
    const user = messages.find((m) => m.role === "user");
    expect(user?.content).toContain("coluna 0 = data");
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
pnpm exec vitest run packages/core/src/ai/openrouter/extrato-column-hint.test.ts -v
```

- [ ] **Step 4: Implement in `schemas.ts`**

Add helper and extend signatures:

```typescript
import type { ExtratoColumnMap } from "../../ingest/extrato-column-map";
import { buildExtratoColumnPromptHint } from "../../ingest/extrato-column-map";

type ExtratoPayloadOptions = { extratoColumnMap?: ExtratoColumnMap };

function appendExtratoColumnHint(
  content: string,
  options?: ExtratoPayloadOptions,
): string {
  if (!options?.extratoColumnMap) return content;
  const hint = buildExtratoColumnPromptHint(options.extratoColumnMap);
  return `${content}\n\n---\n${hint}\n---`;
}

export function buildExtratoTextPayload(
  statementText: string,
  model: string,
  options?: ExtratoPayloadOptions,
): Record<string, unknown> {
  return withMaxTokens({
    model,
    messages: [
      { role: "system", content: extratoSystemPrompt(model) },
      {
        role: "user",
        content: appendExtratoColumnHint(
          "Extraia todas as transações do texto abaixo.\n\n---\n" +
            statementText +
            "\n---",
          options,
        ),
      },
    ],
    // response_format unchanged
  });
}
```

Apply the same `options?: ExtratoPayloadOptions` parameter to `buildExtratoImagePayload` and `buildExtratoFilePayload` (append hint to the text part of the user message).

Update callers in `packages/core/src/ai/openrouter/extrato.ts`:

```typescript
const payload = buildExtratoTextPayload(normalized, model, options);
// same for image/file builders — pass `options` through
```

- [ ] **Step 5: Run tests**

```bash
pnpm exec vitest run packages/core/src/ai/openrouter/extrato-column-hint.test.ts packages/core/src/ingest/extrato-column-map.test.ts -v
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ai/openrouter-types.ts packages/core/src/ai/openrouter/schemas.ts packages/core/src/ai/openrouter/extrato.ts packages/core/src/ai/openrouter/extrato-column-hint.test.ts
git commit -m "feat(core): inject extrato column map into OpenRouter prompts"
```

---

### Task 3: API — aceitar mapa no `processar`

**Files:**
- Modify: `apps/web/lib/pagina-pdf-route.ts`
- Modify: `apps/web/hooks/use-prestacao-submit.ts` (função `processarPaginaExtrato`)

- [ ] **Step 1: Parse body em `pagina-pdf-route.ts`**

Replace `parseForceFlag` with:

```typescript
import { parseExtratoColumnMap, type ExtratoColumnMap } from "@spc-up/core";

async function parseProcessarBody(request: Request): Promise<{
  force: boolean;
  extratoColumnMap?: ExtratoColumnMap;
}> {
  try {
    const body = (await request.json()) as {
      force?: unknown;
      extratoColumnMap?: unknown;
    };
    return {
      force: body?.force === true,
      extratoColumnMap: parseExtratoColumnMap(body?.extratoColumnMap) ?? undefined,
    };
  } catch {
    return { force: false };
  }
}
```

In `handleProcessarPaginaPdf`:

```typescript
const { force, extratoColumnMap } = await parseProcessarBody(request);
// ...
processarPaginaPdfExtrato(ctx.db, ctx.arquivoId, ctx.pagina, prestadorCtx, {
  force,
  modo,
  extratoColumnMap,
});
```

- [ ] **Step 2: Enviar mapa no cliente**

In `use-prestacao-submit.ts`, extend `processarPaginaExtrato`:

```typescript
export async function processarPaginaExtrato(
  sessaoId: string,
  arquivoId: string,
  pagina: number,
  options?: {
    force?: boolean;
    signal?: AbortSignal;
    extratoColumnMap?: ExtratoColumnMap;
  },
): Promise<...> {
  const init: RequestInit = { method: "POST", signal: options?.signal };
  const body: Record<string, unknown> = {};
  if (options?.force) body.force = true;
  if (options?.extratoColumnMap) body.extratoColumnMap = options.extratoColumnMap;
  if (Object.keys(body).length > 0) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  // ...
}
```

Import `ExtratoColumnMap` from `@spc-up/core`.

- [ ] **Step 3: Manual smoke**

Com sessão de dev e um PDF armazenado, `curl` POST com body `{"extratoColumnMap":{"paginaReferencia":1,"colunas":[{"campo":"data","colunaIndex":0},{"campo":"valor","colunaIndex":1},{"campo":"documento","colunaIndex":2}]}}` — deve retornar 200 ou erro de ingestão conhecido, não 400 por parse.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/pagina-pdf-route.ts apps/web/hooks/use-prestacao-submit.ts
git commit -m "feat(web): pass extrato column map to page processing API"
```

---

### Task 4: Cliente — chave de arquivo e clique → coluna

**Files:**
- Create: `apps/web/lib/extrato-column-map-client.ts`
- Create: `apps/web/lib/extrato-column-map-client.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  clientFileKey,
  resolveColumnIndexFromClick,
} from "./extrato-column-map-client";

describe("clientFileKey", () => {
  it("is stable for same file metadata", () => {
    const f = new File(["x"], "a.pdf", { lastModified: 1 });
    expect(clientFileKey(f)).toBe(clientFileKey(f));
  });
});

describe("resolveColumnIndexFromClick", () => {
  it("bins click x into column index", () => {
    const idx = resolveColumnIndexFromClick({
      clickXNorm: 0.75,
      columnCount: 4,
    });
    expect(idx).toBe(3);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
export function clientFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function resolveColumnIndexFromClick(params: {
  clickXNorm: number;
  columnCount: number;
}): number {
  const { clickXNorm, columnCount } = params;
  const n = Math.max(1, columnCount);
  const idx = Math.floor(Math.max(0, Math.min(1, clickXNorm)) * n);
  return Math.min(idx, n - 1);
}

/** From pdf.js TextItem[] on header row — nearest horizontal cluster */
export function resolveColumnFromTextItems(
  items: Array<{ str: string; transform: number[] }>,
  clickX: number,
  clickY: number,
): { colunaIndex: number; headerLabel?: string } {
  // Pick items within ~12px Y of click; sort by transform[4] (x);
  // assign column index by sorted position among distinct x clusters.
  // (Implement cluster: gap > 20px → new column)
  // Return index of cluster containing clickX.
  throw new Error("implement in step 3");
}
```

Complete `resolveColumnFromTextItems` in implementation (no throw).

- [ ] **Step 3: Run tests and commit**

```bash
pnpm exec vitest run apps/web/lib/extrato-column-map-client.test.ts -v
git add apps/web/lib/extrato-column-map-client.ts apps/web/lib/extrato-column-map-client.test.ts
git commit -m "feat(web): client helpers for extrato column mapping"
```

---

### Task 5: Hook de estado do mapa

**Files:**
- Create: `apps/web/hooks/use-extrato-column-map.ts`

- [ ] **Step 1: Implement hook**

```typescript
"use client";

import { useCallback, useMemo, useState } from "react";
import {
  slugCustomField,
  validateExtratoColumnMap,
  type ExtratoColumnMap,
  type ExtratoColumnMapEntry,
} from "@spc-up/core";
import { clientFileKey } from "@/lib/extrato-column-map-client";

const CAMPOS_INICIAIS = [
  "data",
  "valor",
  "direcao",
  "documento",
  "nome",
  "historico",
  "cred_dev",
] as const;

export function useExtratoColumnMap(files: File[]) {
  const pdfFiles = useMemo(
    () => files.filter((f) => f.name.toLowerCase().endsWith(".pdf")),
    [files],
  );
  const [maps, setMaps] = useState<Record<string, ExtratoColumnMap>>({});
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [selectedCampo, setSelectedCampo] = useState<string>("data");
  const [inferirDirecao, setInferirDirecao] = useState(false);

  const activeFile = pdfFiles.find((f) => clientFileKey(f) === activeKey) ?? pdfFiles[0];
  const activeMap = activeFile ? maps[clientFileKey(activeFile)] : undefined;

  const assignColumn = useCallback(
    (entry: Omit<ExtratoColumnMapEntry, "campo"> & { campo: string }) => {
      if (!activeFile) return;
      const key = clientFileKey(activeFile);
      setMaps((prev) => {
        const current = prev[key] ?? { paginaReferencia: 1, colunas: [] };
        const colunas = current.colunas.filter((c) => c.campo !== entry.campo);
        colunas.push(entry);
        return {
          ...prev,
          [key]: {
            paginaReferencia: 1,
            inferirDirecaoDoValor: inferirDirecao,
            colunas,
          },
        };
      });
    },
    [activeFile, inferirDirecao],
  );

  const addCustomField = useCallback((label: string) => {
    const campo = slugCustomField(label);
    setSelectedCampo(campo);
    // store label in next assignColumn call via pending label state if needed
  }, []);

  const allMapped = pdfFiles.every((f) => {
    const m = maps[clientFileKey(f)];
    return m != null && validateExtratoColumnMap(m).ok;
  });

  return {
    pdfFiles,
    maps,
    activeFile,
    activeKey: activeFile ? clientFileKey(activeFile) : null,
    setActiveKey,
    activeMap,
    selectedCampo,
    setSelectedCampo,
    inferirDirecao,
    setInferirDirecao,
    assignColumn,
    addCustomField,
    allMapped,
  };
}
```

Wire `inferirDirecaoDoValor` into map on toggle.

- [ ] **Step 2: Commit**

```bash
git add apps/web/hooks/use-extrato-column-map.ts
git commit -m "feat(web): hook for per-PDF extrato column maps"
```

---

### Task 6: UI — painel de mapeamento (pdf.js + clique)

**Files:**
- Create: `apps/web/components/prestacao/extrato-column-map-panel.tsx`

- [ ] **Step 1: Build panel**

Reuse worker setup from `pdf-origem-viewer.tsx` but load `arrayBuffer` from `File`:

```typescript
const data = await file.arrayBuffer();
const doc = await pdfjs.getDocument({ data }).promise;
const page = await doc.getPage(1);
```

On canvas click `(offsetX / width)` → `resolveColumnIndexFromClick` with `columnCount` default 6 for scan, or from `resolveColumnFromTextItems` when `getTextContent()` returns items.

Props:

```typescript
export type ExtratoColumnMapPanelProps = {
  file: File;
  map: ExtratoColumnMap | undefined;
  selectedCampo: string;
  inferirDirecao: boolean;
  onInferirDirecaoChange: (v: boolean) => void;
  onAssign: (entry: ExtratoColumnMapEntry) => void;
  onAddCustomField: (label: string) => void;
};
```

Right column: checklist of `CAMPOS_INICIAIS` + custom fields from `map.colunas` where `campo.startsWith("custom_")`; status icons; input + botão “Adicionar campo”.

- [ ] **Step 2: Visual check**

Run `pnpm --filter web dev`, wizard step 6 with a test PDF — clique associa campo selecionado.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/prestacao/extrato-column-map-panel.tsx
git commit -m "feat(web): extrato column map panel with pdf.js preview"
```

---

### Task 7: Wizard — etapa 6 e bloqueio de envio

**Files:**
- Modify: `apps/web/components/prestacao/prestacao-flow-steps.ts`
- Modify: `apps/web/components/prestacao/wizard.tsx`
- Modify: `apps/web/hooks/use-prestacao-submit.ts` (`PrestacaoSubmitInput`)

- [ ] **Step 1: Update steps**

`prestacao-flow-steps.ts`:

```typescript
export const WIZARD_STEPS = [
  // ...1-5 unchanged
  { id: 6, label: "Mapear extratos" },
] as const;

export const END_TO_END_FLOW_STEPS = [
  ...WIZARD_STEPS,
  { id: 7, label: "Movimentações" },
  { id: 8, label: "Export" },
] as const;
```

- [ ] **Step 2: Wizard step 6**

- `const hasPdf = files.some(isPdfFile)` — if false, skip step 6 in navigation (step 5 → submit).
- Step 6: render `ExtratoColumnMapPanel` per `useExtratoColumnMap`; tabs “Extrato i de N”.
- Botão **Enviar prestação** só no último passo visível; disabled se `hasPdf && !allMapped`.
- Pass `extratoColumnMaps: Record<string, ExtratoColumnMap>` to `submit()` keyed by `clientFileKey`.

- [ ] **Step 3: Submit hook — attach map to PDF jobs**

In `use-prestacao-submit.ts`:

```typescript
export type PrestacaoSubmitInput = {
  // ...
  extratoColumnMaps?: Record<string, ExtratoColumnMap>;
};
```

When processing `pdfJobs`, resolve map:

```typescript
const map =
  input.extratoColumnMaps?.[
    clientFileKey(input.files.find((f) => f.name === job.nome) ?? ...)
  ];
await processarPaginaExtrato(sessaoId, job.arquivoId, pagina, {
  signal: submitSignal,
  extratoColumnMap: map,
});
```

Match file by `job.nome` + size/lastModified if multiple same name — prefer storing `clientFileKey` on `pdfJobs` at upload time.

Extend `pdfJobs` type:

```typescript
type PdfJob = {
  // ...
  clientFileKey: string;
};
```

Set `clientFileKey` when pushing job from upload loop.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/prestacao/prestacao-flow-steps.ts apps/web/components/prestacao/wizard.tsx apps/web/hooks/use-prestacao-submit.ts
git commit -m "feat(web): wizard step to map PDF columns before ingest"
```

---

### Task 8: Regressão e documentação

**Files:**
- Modify: `docs/dev-scripts.md` (one paragraph on wizard column map)

- [ ] **Step 1: Run core + web tests**

```bash
pnpm exec vitest run packages/core/src/ingest/extrato-column-map.test.ts packages/core/src/ai/openrouter/extrato-column-hint.test.ts apps/web/lib/extrato-column-map-client.test.ts -v
```

- [ ] **Step 2: Run existing prestacao tests**

```bash
pnpm exec vitest run packages/core/src/prestacao/process-sessao.test.ts packages/core/src/ingest/dual-extract-page.test.ts -v
```

Expected: PASS (no behavior change when map omitted).

- [ ] **Step 3: Note in dev-scripts**

Add under prestação wizard: operador deve mapear colunas na etapa 6; mapa vai no body de `processar`.

- [ ] **Step 4: Commit**

```bash
git add docs/dev-scripts.md
git commit -m "docs: extrato column mapping wizard step"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Passo obrigatório wizard | Task 7 |
| Clique na prévia | Task 4, 6 |
| Campos padrão + ad hoc | Task 5, 6 |
| Um mapa por PDF | Task 5, 7 |
| Hint só para IA | Task 1, 2 |
| Validação data+valor+(doc ou nome+hist) | Task 1, 5, 7 |
| inferir direcao do valor | Task 1, 5, 6 |
| API processar | Task 3 |
| Excel/OFX sem passo | Task 7 (`hasPdf`) |
| Renumerar end-to-end 7–8 | Task 7 |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-pdf-extrato-mapeamento-colunas.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with executing-plans checkpoints  

Which approach do you want?
