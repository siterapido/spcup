# Planilha unificada — Plano de implementação (Fase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o fluxo fragmentado de consolidação/revisão por uma planilha única em `/prestacao/[id]/planilha` onde o operador identifica PF/PJ, resolve merges pendentes e libera export.

**Architecture:** Novo módulo `@spc-up/core/planilha` adapta `consolidacao_evento` (≥2 PDFs) ou `movimentacao` flat (1 PDF) para linhas unificadas. API REST `/api/prestacao/sessoes/:id/planilha` delega escrita a `assignPessoaToMovimentacao`, PATCH de `consolidacao_evento` e `approveConsolidacaoEvento`/`rejectConsolidacaoEvento`. Web: wizard compacto, redirects, componentes `planilha-table` + `planilha-toolbar`.

**Tech Stack:** TypeScript, Vitest (`packages/core`), Next.js App Router (`apps/web`), Drizzle (`@spc-up/db`), componentes existentes (`pdf-origem-viewer`, `searchPessoas`).

**Spec:** [2026-06-07-planilha-unificada-design.md](../specs/2026-06-07-planilha-unificada-design.md)

---

## Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/core/src/planilha/types.ts` | Criar — tipos `PlanilhaLinha`, `PlanilhaResumo`, `PlanilhaPayload` |
| `packages/core/src/planilha/status.ts` | Criar — `deriveLinhaStatus`, `isLinhaPronta`, `buildResumo` |
| `packages/core/src/planilha/list.ts` | Criar — `listPlanilhaForSessao` |
| `packages/core/src/planilha/mutations.ts` | Criar — `updatePlanilhaLinhaPessoa`, `applyPlanilhaLote`, `resolvePlanilhaMerge` |
| `packages/core/src/planilha/list.test.ts` | Criar — testes unitários adapter |
| `packages/core/src/planilha/status.test.ts` | Criar — testes faixas confiança / prontidão |
| `packages/core/src/index.ts` | Modificar — exports planilha |
| `apps/web/app/api/prestacao/sessoes/[id]/planilha/route.ts` | Criar — GET |
| `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts` | Criar — PATCH |
| `apps/web/app/api/prestacao/sessoes/[id]/planilha/lote/route.ts` | Criar — POST |
| `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/merge/route.ts` | Criar — POST |
| `apps/web/app/prestacao/[sessaoId]/planilha/page.tsx` | Criar |
| `apps/web/components/prestacao/planilha-toolbar.tsx` | Criar |
| `apps/web/components/prestacao/planilha-table.tsx` | Criar |
| `apps/web/components/prestacao/planilha-pessoa-cell.tsx` | Criar — autocomplete (extrair de `review-drawer`) |
| `apps/web/components/prestacao/wizard.tsx` | Modificar — tela única compacta |
| `apps/web/hooks/use-prestacao-submit.ts` | Modificar — redirect `/planilha`, auto `consolidarExtratos` |
| `apps/web/components/prestacao/prestacao-flow-steps.ts` | Modificar — 3 passos |
| `apps/web/components/prestacao/sessoes-list.tsx` | Modificar — link `/planilha` |
| `apps/web/app/prestacao/[sessaoId]/consolidacao/page.tsx` | Modificar — redirect |
| `apps/web/app/prestacao/[sessaoId]/kanban/page.tsx` | Modificar — redirect |
| `apps/web/app/prestacao/[sessaoId]/movimentacoes/page.tsx` | Criar — redirect (rota citada no spec) |
| `scripts/web-e2e-prestacao.ts` | Modificar — assert `/planilha` |

---

### Task 1: Tipos e helpers de status

**Files:**
- Create: `packages/core/src/planilha/types.ts`
- Create: `packages/core/src/planilha/status.ts`
- Test: `packages/core/src/planilha/status.test.ts`

- [ ] **Step 1: Escrever testes falhando para status**

```typescript
// packages/core/src/planilha/status.test.ts
import { describe, expect, it } from "vitest";
import { deriveLinhaStatus, isLinhaPronta, buildResumo } from "./status";
import type { PlanilhaLinha } from "./types";

function linha(partial: Partial<PlanilhaLinha>): PlanilhaLinha {
  return {
    id: "1",
    fonte: "consolidacao",
    dataMovimento: "2025-01-15",
    valor: "100.00",
    direcao: "ENTRADA",
    descricao: "TESTE",
    confianca: 0.9,
    status: "pendente",
    pessoa: null,
    origens: [],
    eventoStatus: "PENDENTE",
    extracaoDuvidosa: false,
    ...partial,
  };
}

describe("isLinhaPronta", () => {
  it("false sem pessoa", () => {
    expect(isLinhaPronta(linha({ pessoa: null, confianca: 0.9 }))).toBe(false);
  });

  it("false com confianca abaixo de 0.6", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          confianca: 0.5,
          status: "pendente",
        }),
      ),
    ).toBe(false);
  });

  it("false com merge_pendente", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          status: "merge_pendente",
        }),
      ),
    ).toBe(false);
  });

  it("true com pessoa e confianca >= 0.6", () => {
    expect(
      isLinhaPronta(
        linha({
          pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
          confianca: 0.65,
          status: "pronta",
        }),
      ),
    ).toBe(true);
  });
});

describe("deriveLinhaStatus", () => {
  it("merge_pendente quando evento PENDENTE com 2+ origens", () => {
    expect(
      deriveLinhaStatus({
        eventoStatus: "PENDENTE",
        origemCount: 2,
        pessoa: null,
        confianca: 0.8,
        extracaoDuvidosa: false,
      }),
    ).toBe("merge_pendente");
  });

  it("extracao_duvidosa tem prioridade", () => {
    expect(
      deriveLinhaStatus({
        eventoStatus: "PENDENTE",
        origemCount: 1,
        pessoa: null,
        confianca: 0.4,
        extracaoDuvidosa: true,
      }),
    ).toBe("extracao_duvidosa");
  });
});

describe("buildResumo", () => {
  it("conta prontas e exportavel", () => {
    const linhas = [
      linha({
        status: "pronta",
        pessoa: { id: "p", tipo: "PF", nome: "A", documento: "12345678901" },
      }),
      linha({ status: "pendente", pessoa: null }),
    ];
    const resumo = buildResumo(linhas, false);
    expect(resumo.total).toBe(2);
    expect(resumo.prontas).toBe(1);
    expect(resumo.exportavel).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar testes — devem falhar**

```bash
cd packages/core && pnpm exec vitest run src/planilha/status.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implementar types e status**

```typescript
// packages/core/src/planilha/types.ts
export type PlanilhaLinhaStatus =
  | "pronta"
  | "pendente"
  | "merge_pendente"
  | "extracao_duvidosa";

export type PlanilhaLinhaFonte = "consolidacao" | "movimentacao";

export type PlanilhaPessoa = {
  id: string;
  tipo: "PF" | "PJ";
  nome: string;
  documento: string;
};

export type PlanilhaOrigem = {
  movimentacaoId: string;
  nomeArquivo: string | null;
  pagina?: number;
  descricaoRaw: string;
  papel?: string;
};

export type PlanilhaLinha = {
  id: string;
  fonte: PlanilhaLinhaFonte;
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricao: string;
  confianca: number;
  status: PlanilhaLinhaStatus;
  pessoa: PlanilhaPessoa | null;
  origens: PlanilhaOrigem[];
  /** Metadados internos para deriveLinhaStatus / escrita */
  eventoStatus?: string;
  extracaoDuvidosa: boolean;
};

export type PlanilhaResumo = {
  total: number;
  prontas: number;
  semPessoa: number;
  baixaConfianca: number;
  mergePendente: number;
  extracaoDuvidosa: number;
  cadastroAlerta: boolean;
  exportavel: boolean;
};

export type PlanilhaPayload = {
  sessao: { id: string; uf: string; exercicio: number };
  linhas: PlanilhaLinha[];
  resumo: PlanilhaResumo;
};
```

```typescript
// packages/core/src/planilha/status.ts
import { getConfiancaLimiarBaixa } from "../consolidacao/thresholds";
import type { PlanilhaLinha, PlanilhaResumo } from "./types";

const LIMIAR_BAIXA = () => getConfiancaLimiarBaixa();

export function deriveLinhaStatus(input: {
  eventoStatus?: string;
  origemCount: number;
  pessoa: PlanilhaLinha["pessoa"];
  confianca: number;
  extracaoDuvidosa: boolean;
}): PlanilhaLinha["status"] {
  if (input.extracaoDuvidosa) return "extracao_duvidosa";
  if (
    input.eventoStatus === "PENDENTE" &&
    input.origemCount >= 2
  ) {
    return "merge_pendente";
  }
  const draft: PlanilhaLinha = {
    id: "",
    fonte: "movimentacao",
    dataMovimento: "",
    valor: "",
    direcao: "",
    descricao: "",
    confianca: input.confianca,
    status: "pendente",
    pessoa: input.pessoa,
    origens: [],
    extracaoDuvidosa: false,
  };
  return isLinhaPronta(draft) ? "pronta" : "pendente";
}

export function isLinhaPronta(linha: PlanilhaLinha): boolean {
  if (linha.status === "merge_pendente" || linha.status === "extracao_duvidosa") {
    return false;
  }
  if (!linha.pessoa) return false;
  if (linha.confianca < LIMIAR_BAIXA()) return false;
  return true;
}

export function buildResumo(
  linhas: PlanilhaLinha[],
  cadastroAlerta: boolean,
): PlanilhaResumo {
  const limiar = LIMIAR_BAIXA();
  let prontas = 0;
  let semPessoa = 0;
  let baixaConfianca = 0;
  let mergePendente = 0;
  let extracaoDuvidosa = 0;

  for (const l of linhas) {
    if (isLinhaPronta(l)) prontas++;
    if (!l.pessoa) semPessoa++;
    if (l.confianca < limiar) baixaConfianca++;
    if (l.status === "merge_pendente") mergePendente++;
    if (l.status === "extracao_duvidosa") extracaoDuvidosa++;
  }

  return {
    total: linhas.length,
    prontas,
    semPessoa,
    baixaConfianca,
    mergePendente,
    extracaoDuvidosa,
    cadastroAlerta,
    exportavel: linhas.length > 0 && prontas === linhas.length,
  };
}
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
cd packages/core && pnpm exec vitest run src/planilha/status.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/planilha/
git commit -m "feat(core): add planilha status helpers"
```

---

### Task 2: `listPlanilhaForSessao` (adapter)

**Files:**
- Create: `packages/core/src/planilha/list.ts`
- Create: `packages/core/src/planilha/list.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Escrever teste unitário do mapper (sem DB)**

Testar funções puras `mapConsolidacaoEventoToLinha` e `mapMovimentacaoToLinha` exportadas de `list.ts`:

```typescript
// packages/core/src/planilha/list.test.ts
import { describe, expect, it } from "vitest";
import { mapConsolidacaoEventoToLinha, mapMovimentacaoToLinha } from "./list";

describe("mapConsolidacaoEventoToLinha", () => {
  it("marca merge_pendente com 2 linhas PENDENTE", () => {
    const linha = mapConsolidacaoEventoToLinha({
      id: "ev-1",
      status: "PENDENTE",
      dataMovimento: "2025-01-15",
      valor: "50.00",
      direcao: "SAIDA",
      confianca: 0.7,
      justificativa: null,
      pessoa: null,
      linhas: [
        {
          movimentacaoId: "m1",
          papel: "PIX",
          descricaoRaw: "PIX JOAO",
          nomeArquivo: "pix.pdf",
          origemExtracao: { pagina: 1, indiceLinha: 2, nomeArquivo: "pix.pdf" },
        },
        {
          movimentacaoId: "m2",
          papel: "COMPLETO",
          descricaoRaw: "JOAO CPF 123",
          nomeArquivo: "total.pdf",
          origemExtracao: { pagina: 2, indiceLinha: 1, nomeArquivo: "total.pdf" },
        },
      ],
    });
    expect(linha.fonte).toBe("consolidacao");
    expect(linha.status).toBe("merge_pendente");
    expect(linha.origens).toHaveLength(2);
  });
});

describe("mapMovimentacaoToLinha", () => {
  it("mapeia movimentacao flat", () => {
    const linha = mapMovimentacaoToLinha({
      id: "m1",
      dataMovimento: "2025-01-01",
      valor: "10.00",
      direcao: "ENTRADA",
      descricaoRaw: "DEPOSITO",
      confiancaGlobal: 0.85,
      pessoaFisica: { id: "pf1", nome: "MARIA", cpf: "12345678901" },
      pessoaJuridica: null,
      nomeArquivo: "extrato.pdf",
      origemExtracao: null,
      statusPaginaVerificar: false,
    });
    expect(linha.fonte).toBe("movimentacao");
    expect(linha.pessoa?.tipo).toBe("PF");
    expect(linha.status).toBe("pronta");
  });
});
```

- [ ] **Step 2: Rodar — FAIL**

```bash
cd packages/core && pnpm exec vitest run src/planilha/list.test.ts
```

- [ ] **Step 3: Implementar `list.ts`**

Regras:
- `cleanDescricao(desc)` — reutilizar lógica de `stripDocumentsFromDescricao` + normalize (copiar padrão de `consolidacao-table.tsx` ou extrair para `packages/core/src/planilha/descricao.ts`)
- `listPlanilhaForSessao(db, sessaoId)`:
  1. `const { eventos, cadastroAlerta, pdfCount } = await listConsolidacaoForSessao(db, sessaoId)`
  2. Se `eventos.length > 0`: mapear cada evento com `status !== 'REJEITADO'` → linha
  3. Senão: carregar movimentações (`movimentacaoCanonicaId IS NULL`, `deletedAt IS NULL`) e mapear flat
  4. Para eventos `REJEITADO`, incluir movimentações das linhas como `fonte=movimentacao` (ids não absorvidos)
  5. `buildResumo(linhas, cadastroAlerta)`
- `extracaoDuvidosa`: `origemExtracao` ausente com confiança muito baixa OU flag em evidências `PAGINA_VERIFICAR` se disponível no mov

```typescript
// packages/core/src/planilha/list.ts — assinatura principal
export async function listPlanilhaForSessao(
  db: Db,
  sessaoId: string,
): Promise<PlanilhaPayload | null> {
  const sessao = await getSessao(db, sessaoId);
  if (!sessao) return null;
  // ... implementação conforme regras acima
}
```

- [ ] **Step 4: Exportar em `packages/core/src/index.ts`**

```typescript
export {
  listPlanilhaForSessao,
  mapConsolidacaoEventoToLinha,
  mapMovimentacaoToLinha,
} from "./planilha/list";
export type { PlanilhaLinha, PlanilhaPayload, PlanilhaResumo } from "./planilha/types";
export { isLinhaPronta, buildResumo } from "./planilha/status";
```

- [ ] **Step 5: Rodar testes planilha + regressão consolidacao**

```bash
cd packages/core && pnpm exec vitest run src/planilha/ src/consolidacao/bahia-fixture.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/planilha/list.ts packages/core/src/planilha/list.test.ts packages/core/src/index.ts
git commit -m "feat(core): listPlanilhaForSessao adapter"
```

---

### Task 3: Mutações planilha (PF/PJ, lote, merge)

**Files:**
- Create: `packages/core/src/planilha/mutations.ts`
- Create: `packages/core/src/planilha/mutations.test.ts`

- [ ] **Step 1: Testes com mocks de db (ou integração leve)**

```typescript
import { describe, expect, it, vi } from "vitest";
import { resolvePlanilhaMerge } from "./mutations";

describe("resolvePlanilhaMerge", () => {
  it("confirmar delega approveConsolidacaoEvento", async () => {
    const approve = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "confirmar", { approveConsolidacaoEvento: approve });
    expect(approve).toHaveBeenCalledWith(db, "ev-1");
  });

  it("separar delega rejectConsolidacaoEvento", async () => {
    const reject = vi.fn();
    const db = {} as never;
    await resolvePlanilhaMerge(db, "ev-1", "separar", { rejectConsolidacaoEvento: reject });
    expect(reject).toHaveBeenCalledWith(db, "ev-1");
  });
});
```

- [ ] **Step 2: Implementar `mutations.ts`**

```typescript
import { consolidacaoEvento, type Db } from "@spc-up/db";
import { eq } from "drizzle-orm";
import { approveConsolidacaoEvento, rejectConsolidacaoEvento } from "../consolidacao/approve";
import { assignPessoaToMovimentacao } from "../prestacao/movimentacao-review";
import type { PlanilhaLinhaFonte } from "./types";

export async function updatePlanilhaLinhaPessoa(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
  body: { pessoaFisicaId?: string; pessoaJuridicaId?: string; limparPessoa?: true },
): Promise<void> {
  if (fonte === "movimentacao") {
    await assignPessoaToMovimentacao(db, linhaId, body);
    return;
  }
  await db.update(consolidacaoEvento).set({
    pessoaFisicaId: body.limparPessoa ? null : body.pessoaFisicaId ?? null,
    pessoaJuridicaId: body.limparPessoa ? null : body.pessoaJuridicaId ?? null,
    confianca: body.pessoaFisicaId || body.pessoaJuridicaId ? 0.95 : undefined,
    justificativa: body.pessoaFisicaId || body.pessoaJuridicaId ? "Vínculo manual na planilha" : undefined,
  }).where(eq(consolidacaoEvento.id, linhaId));
}

export async function applyPlanilhaLote(
  db: Db,
  items: Array<{ id: string; fonte: PlanilhaLinhaFonte }>,
  pessoa: { pessoaFisicaId?: string; pessoaJuridicaId?: string },
): Promise<void> {
  for (const item of items) {
    await updatePlanilhaLinhaPessoa(db, item.id, item.fonte, pessoa);
  }
}

export async function resolvePlanilhaMerge(
  db: Db,
  eventoId: string,
  acao: "confirmar" | "separar",
  deps: {
    approveConsolidacaoEvento?: typeof approveConsolidacaoEvento;
    rejectConsolidacaoEvento?: typeof rejectConsolidacaoEvento;
  } = {},
): Promise<void> {
  const approve = deps.approveConsolidacaoEvento ?? approveConsolidacaoEvento;
  const reject = deps.rejectConsolidacaoEvento ?? rejectConsolidacaoEvento;
  if (acao === "confirmar") {
    await approve(db, eventoId);
    return;
  }
  await reject(db, eventoId);
}
```

- [ ] **Step 3: Exportar mutations em `index.ts`**

- [ ] **Step 4: Rodar testes**

```bash
cd packages/core && pnpm exec vitest run src/planilha/
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): planilha mutations for pessoa and merge"
```

---

### Task 4: API routes planilha

**Files:**
- Create: `apps/web/app/api/prestacao/sessoes/[id]/planilha/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/planilha/lote/route.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/merge/route.ts`

- [ ] **Step 1: GET `/planilha`**

```typescript
// apps/web/app/api/prestacao/sessoes/[id]/planilha/route.ts
import { listPlanilhaForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authResult = await requireSession();
  if ("error" in authResult) return authResult.error;

  const { id } = await context.params;
  const db = getDb();
  const payload = await listPlanilhaForSessao(db, id);
  if (!payload) {
    return NextResponse.json({ error: "Sessão não encontrada" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
```

- [ ] **Step 2: PATCH linha — body `{ fonte, pessoaFisicaId?, pessoaJuridicaId?, limparPessoa? }`**

Validar com zod; chamar `updatePlanilhaLinhaPessoa`; `revalidatePath(/prestacao/${id}/planilha)`.

- [ ] **Step 3: POST lote — body `{ items: [{ id, fonte }], pessoaFisicaId?, pessoaJuridicaId? }`**

- [ ] **Step 4: POST merge — body `{ acao: "confirmar" | "separar" }`** — só `fonte=consolidacao`; 400 se movimentacao.

- [ ] **Step 5: Smoke manual**

```bash
# com sessão existente no banco local
curl -s -b cookies.txt http://localhost:3000/api/prestacao/SESSAO_ID/planilha | jq '.resumo'
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): planilha API routes"
```

---

### Task 5: Redirects e navegação

**Files:**
- Create: `apps/web/app/prestacao/[sessaoId]/planilha/page.tsx` (shell mínimo primeiro)
- Modify: `apps/web/app/prestacao/[sessaoId]/consolidacao/page.tsx`
- Modify: `apps/web/app/prestacao/[sessaoId]/kanban/page.tsx`
- Create: `apps/web/app/prestacao/[sessaoId]/movimentacoes/page.tsx`
- Modify: `apps/web/components/prestacao/sessoes-list.tsx`

- [ ] **Step 1: Redirects**

```typescript
// consolidacao/page.tsx, kanban/page.tsx, movimentacoes/page.tsx
import { redirect } from "next/navigation";

export default async function LegacyPage({
  params,
}: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = await params;
  redirect(`/prestacao/${sessaoId}/planilha`);
}
```

- [ ] **Step 2: `planilha/page.tsx` server component**

```typescript
import { listPlanilhaForSessao } from "@spc-up/core";
import { getDb } from "@spc-up/db";
import { PlanilhaView } from "@/components/prestacao/planilha-table";

export default async function PlanilhaPage({
  params,
}: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = await params;
  const db = getDb();
  const payload = await listPlanilhaForSessao(db, sessaoId);
  if (!payload) throw new Error("Sessão não encontrada");
  return (
    <main className="mx-auto max-w-[min(96rem,100%)] px-4 py-10">
      <PlanilhaView sessaoId={sessaoId} initial={payload} />
    </main>
  );
}
```

- [ ] **Step 3: `sessoes-list.tsx` — href principal `/prestacao/${id}/planilha`; remover ênfase em `consolidarExtratos`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): planilha route and legacy redirects"
```

---

### Task 6: Wizard compacto + submit redirect

**Files:**
- Modify: `apps/web/components/prestacao/wizard.tsx`
- Modify: `apps/web/hooks/use-prestacao-submit.ts`
- Modify: `apps/web/components/prestacao/prestacao-flow-steps.ts`

- [ ] **Step 1: `prestacao-flow-steps.ts`**

```typescript
export const END_TO_END_FLOW_STEPS = [
  { id: 1, label: "Upload" },
  { id: 2, label: "Planilha" },
  { id: 3, label: "Export" },
] as const;
```

- [ ] **Step 2: Wizard — uma tela**

Remover stepper multi-step; renderizar num único `Card`:
- UF select
- Toggle Estadual/Municipal + dropdown municipal
- Exercício input
- `AttachmentDropzone`
- Remover checkbox `consolidarExtratos`
- Remover passo fixo `WIZARD_STEP_MAPEAR_EXTRATOS` — manter `ExtratoColumnMapPanel` só em modal quando `fileErrors` indicar falha de extração

- [ ] **Step 3: `use-prestacao-submit.ts`**

```typescript
// Ao criar sessão:
consolidarExtratos: (input.files?.filter(isPdfFile).length ?? 0) >= 2,

// Redirect final — sempre:
const redirectPath = `/prestacao/${sessaoId}/planilha`;
```

Remover bifurcação `goConsolidacao ? consolidacao : kanban`.

- [ ] **Step 4: Testar upload local manualmente**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): compact wizard and planilha redirect"
```

---

### Task 7: `planilha-toolbar.tsx`

**Files:**
- Create: `apps/web/components/prestacao/planilha-toolbar.tsx`

- [ ] **Step 1: Implementar toolbar**

Props: `resumo`, `sessaoId`, `activeFilter`, `onFilterChange`, `onExportClick`

- Barra progresso: `{prontas}/{total} prontas para export`
- Chips filtro: todos, sem pessoa, baixa confiança, merge pendente, extração duvidosa
- Banner cadastro se `cadastroAlerta`
- Botão Exportar: `Link` para `/prestacao/${sessaoId}/export` se `exportavel`; senão `button` disabled + `onExportClick` scroll

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(web): planilha toolbar"
```

---

### Task 8: `planilha-pessoa-cell.tsx` + `planilha-table.tsx`

**Files:**
- Create: `apps/web/components/prestacao/planilha-pessoa-cell.tsx`
- Create: `apps/web/components/prestacao/planilha-table.tsx`

- [ ] **Step 1: Extrair autocomplete de `review-drawer.tsx`**

`planilha-pessoa-cell.tsx`:
- Input debounced → `GET /api/pessoas?q=...`
- Lista dropdown; onSelect → `PATCH /api/.../planilha/linhas/:id` com `{ fonte, pessoaFisicaId | pessoaJuridicaId }`
- Exibir nome + `maskDocumento`

- [ ] **Step 2: `planilha-table.tsx` client component `PlanilhaView`**

- Estado: `linhas`, `resumo`, `selectedIds`, `filter`, `pdfPanel` (movimentacaoId para viewer)
- Tabela com colunas do spec
- Badge origens expansível (`<details>` ou row expand)
- Ações merge: POST merge route
- Checkbox + botão "Aplicar pessoa" → modal escolha pessoa → POST lote
- `confiancaTone` — copiar de `review-drawer.tsx`
- Integrar `PdfOrigemViewer` em painel lateral ao clicar "Ver PDF"

- [ ] **Step 3: Wire em `planilha/page.tsx`**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): planilha table with inline pessoa and PDF panel"
```

---

### Task 9: Atualizar revalidatePath nos endpoints legados

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/eventos/[eid]/aprovar/route.ts`
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/eventos/[eid]/rejeitar/route.ts`

- [ ] **Step 1: Adicionar `revalidatePath(`/prestacao/${id}/planilha`)` junto aos paths existentes**

- [ ] **Step 2: Commit**

```bash
git commit -m "chore(web): revalidate planilha on consolidacao actions"
```

---

### Task 10: E2E e regressão

**Files:**
- Modify: `scripts/web-e2e-prestacao.ts`

- [ ] **Step 1: Atualizar script E2E**

Após processamento, navegar para `/prestacao/${sessaoId}/planilha` em vez de consolidacao/kanban; assert `resumo.total > 0`.

- [ ] **Step 2: Rodar testes core**

```bash
cd packages/core && pnpm exec vitest run
```

- [ ] **Step 3: Rodar E2E (se ambiente configurado)**

```bash
pnpm exec tsx scripts/web-e2e-prestacao.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "test: e2e planilha flow"
```

---

## Checklist de aceite manual (spec §10)

- [ ] Bahia PIX + completo → linhas com 2 origens
- [ ] 1 PDF → planilha sem erro
- [ ] PF/PJ inline persiste
- [ ] Lote aplica pessoa
- [ ] Merge pendente confirmar/separar
- [ ] Export bloqueado &lt; 100%
- [ ] Redirects `/consolidacao`, `/kanban`, `/movimentacoes`
- [ ] Cadastro vazio → banner

---

## Spec self-review (plano)

| Requisito spec | Task |
|----------------|------|
| Planilha única `/planilha` | 5, 8 |
| Merge auto + pendente | 2, 3, 8 |
| PF/PJ inline + lote | 3, 4, 8 |
| Upload enxuto | 6 |
| Export gate | 7, 8 |
| Faixas confiança 0.6 | 1 |
| Redirects | 5 |
| API Fase 1 | 4 |
| Adapter consolidacao/movimentacao | 2 |
| CLI sem mudança | — (nenhuma task) |
| Fase 2 schema | fora de escopo |

Sem placeholders TBD. Tipos consistentes entre tasks (`fonte` em PATCH/lote).

---

## Fase 2 (não implementar neste plano)

- Migration `movimentacao` canônica
- Import cadastro no upload
- CLI métricas planilha
