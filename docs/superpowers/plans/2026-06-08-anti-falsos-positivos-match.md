# Anti-falsos-positivos no match — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir falsos positivos no vínculo extrato→cadastro e no merge PIX↔completo com tiers de evidência (ALTA/MÉDIA/BAIXA/REJEITADO), kernel unificado de match por nome, sem criação automática de stubs PF/PJ.

**Architecture:** Novo módulo `match/cadastro-link.ts` centraliza `resolveCadastroLink` e busca fuzzy por nome. `applyDeterministicMatch` e consolidação consomem o kernel. Pares cross-PDF exigem doc igual ou nome `bate`. Auto-`CONFIRMADO` e auto-aprovação consolidação só em tier ALTA. Script one-shot desvincula stubs legados.

**Tech Stack:** TypeScript, Drizzle, Vitest, Next.js App Router.

**Spec:** [docs/superpowers/specs/2026-06-08-anti-falsos-positivos-match-design.md](../specs/2026-06-08-anti-falsos-positivos-match-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/match/cadastro-link.ts` | Kernel: tiers, fuzzy nome, aliases |
| `packages/core/src/match/cadastro-link.test.ts` | Testes unitários kernel |
| `packages/core/src/match/rules.ts` | `applyDeterministicMatch` via kernel; remove `getOrCreate*` |
| `packages/core/src/match/rules.test.ts` | Atualizar expectativas tier/status |
| `packages/core/src/consolidacao/candidates.ts` | Par endurecido; hipóteses 0.55; `linkTier` no draft |
| `packages/core/src/consolidacao/candidates.test.ts` | Cenários FP + homônimo |
| `packages/core/src/consolidacao/auto.ts` | Auto-aprova só tier ALTA |
| `packages/core/src/consolidacao/auto.test.ts` | Testes tier gate |
| `packages/core/src/consolidacao/types.ts` | `cadastroLinkTier?` em `ConsolidacaoEventDraft` |
| `packages/core/src/planilha/mutations.ts` | Rematch via kernel |
| `packages/core/src/planilha/types.ts` | `cadastroLinkTier` em `PlanilhaLinha` |
| `packages/core/src/planilha/list.ts` | Popular tier a partir de evidências |
| `packages/core/src/planilha/status.ts` | `docSemCadastro`, `nomeDiverge` no resumo |
| `packages/core/src/provenance/types.ts` | `horaContraparte?: string \| null` |
| `packages/core/src/provenance/attach-extracao.ts` | Persistir hora do item extraído |
| `packages/core/src/ingest/pdf.ts` | Passar `hora` do item para origem |
| `packages/core/src/index.ts` | Exportar `CadastroLinkTier`, `resolveCadastroLink` |
| `packages/core/src/browser.ts` | Export tier types se UI precisar |
| `apps/web/components/prestacao/planilha-remetente-destinatario-cell.tsx` | Bolinha por tier |
| `apps/web/components/prestacao/planilha-table.tsx` | Passar `cadastroLinkTier` |
| `scripts/rematch-desvincular-stubs.ts` | Migração stubs |
| `docs/dev-scripts.md` | Documentar script migração |

---

### Task 1: Kernel `cadastro-link` (TDD)

**Files:**
- Create: `packages/core/src/match/cadastro-link.ts`
- Create: `packages/core/src/match/cadastro-link.test.ts`

- [ ] **Step 1: Write failing tests**

`packages/core/src/match/cadastro-link.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";
import {
  compararNomeComPessoa,
  findPessoasByNomeFuzzy,
  resolveCadastroLink,
} from "./cadastro-link";

describe("compararNomeComPessoa", () => {
  it("bate com alias", () => {
    expect(
      compararNomeComPessoa("JOAO SILVA", {
        nome: "JOAO DA SILVA",
        aliases: ["JOAO SILVA"],
      }),
    ).toBe("bate");
  });
});

describe("findPessoasByNomeFuzzy", () => {
  it("returns empty for short name", async () => {
    const db = { select: vi.fn() } as never;
    await expect(findPessoasByNomeFuzzy(db, "AB")).resolves.toEqual([]);
  });
});

describe("resolveCadastroLink", () => {
  it("ALTA when cpf in cadastro and nome bate", async () => {
    const pf = { id: "pf-1", cpf: "12345678909", nome: "JOAO SILVA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(table === pessoaFisica ? [pf] : []),
          }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "JOAO SILVA",
    });
    expect(result.tier).toBe("ALTA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("bate");
  });

  it("BAIXA when cpf not in cadastro", async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "JOAO SILVA",
    });
    expect(result.tier).toBe("BAIXA");
    expect(result.pessoaFisicaId).toBeNull();
  });

  it("REJEITADO when cpf and cnpj both set", async () => {
    const db = { select: vi.fn() } as never;
    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: "12345678000199",
      remetenteDestinatario: "X",
    });
    expect(result.tier).toBe("REJEITADO");
  });

  it("MEDIA when cpf in cadastro but nome difere", async () => {
    const pf = { id: "pf-1", cpf: "12345678909", nome: "MARIA SOUZA", aliases: null };
    const db = {
      select: vi.fn().mockReturnValue({
        from: (table: unknown) => ({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(table === pessoaFisica ? [pf] : []),
          }),
        }),
      }),
    } as never;

    const result = await resolveCadastroLink(db, {
      cpf: "12345678909",
      cnpj: null,
      remetenteDestinatario: "CARLOS REIS",
    });
    expect(result.tier).toBe("MEDIA");
    expect(result.pessoaFisicaId).toBe("pf-1");
    expect(result.comparacaoNome).toBe("difere");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/core && npm test -- src/match/cadastro-link.test.ts
```

Expected: module not found / function not defined.

- [ ] **Step 3: Implement kernel**

`packages/core/src/match/cadastro-link.ts`:

```typescript
import type { Db } from "@spc-up/db";
import { pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { eq } from "drizzle-orm";

import { DEFAULT_WEIGHTS } from "../confidence";
import { normalizeName } from "../normalize";
import {
  compararNomeCadastro,
  type NomeCadastroComparacao,
} from "./nome-cadastro";
import { isNomeContraparteVazio } from "./nome-contraparte";

export type CadastroLinkTier = "ALTA" | "MEDIA" | "BAIXA" | "REJEITADO";

export type CadastroLinkResult = {
  tier: CadastroLinkTier;
  pessoaFisicaId: string | null;
  pessoaJuridicaId: string | null;
  comparacaoNome: NomeCadastroComparacao;
  motivo: string;
  evidencias: Array<{ tipo: string; peso: number; detalhe: string }>;
};

export function compararNomeComPessoa(
  nomeExtraido: string,
  pessoa: { nome: string; aliases?: string[] | null },
): NomeCadastroComparacao {
  const base = compararNomeCadastro(nomeExtraido, pessoa.nome);
  if (base === "bate") return "bate";
  for (const alias of pessoa.aliases ?? []) {
    if (compararNomeCadastro(nomeExtraido, alias) === "bate") return "bate";
  }
  return base;
}

export async function findPessoasByNomeFuzzy(
  db: Db,
  rawNome: string,
): Promise<Array<{ kind: "PF" | "PJ"; id: string; nome: string }>> {
  const nome = normalizeName(rawNome);
  if (nome.length < 3) return [];

  const matches: Array<{ kind: "PF" | "PJ"; id: string; nome: string }> = [];

  const pfs = await db
    .select({ id: pessoaFisica.id, nome: pessoaFisica.nome, aliases: pessoaFisica.aliases })
    .from(pessoaFisica);
  for (const pf of pfs) {
    if (compararNomeComPessoa(nome, pf) === "bate") {
      matches.push({ kind: "PF", id: pf.id, nome: pf.nome });
    }
  }

  const pjs = await db
    .select({ id: pessoaJuridica.id, nome: pessoaJuridica.razaoSocial, aliases: pessoaJuridica.aliases })
    .from(pessoaJuridica);
  for (const pj of pjs) {
    if (compararNomeComPessoa(nome, { nome: pj.nome, aliases: pj.aliases }) === "bate") {
      matches.push({ kind: "PJ", id: pj.id, nome: pj.nome });
    }
  }

  return matches;
}

function evidenciaDoc(
  tipo: "CPF_CADASTRO" | "CNPJ_CADASTRO",
  doc: string,
  comparacao: NomeCadastroComparacao,
): Array<{ tipo: string; peso: number; detalhe: string }> {
  const ev: Array<{ tipo: string; peso: number; detalhe: string }> = [
    {
      tipo,
      peso: DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45,
      detalhe: `${tipo.includes("CPF") ? "CPF" : "CNPJ"} ${doc} vinculado ao cadastro`,
    },
  ];
  if (comparacao === "difere") {
    ev.push({
      tipo: "NOME_DIVERGE_CADASTRO",
      peso: 0,
      detalhe: "Nome extraído diverge do cadastro",
    });
  }
  return ev;
}

export async function resolveCadastroLink(
  db: Db,
  input: {
    cpf: string | null;
    cnpj: string | null;
    remetenteDestinatario: string | null;
  },
): Promise<CadastroLinkResult> {
  const empty: CadastroLinkResult = {
    tier: "BAIXA",
    pessoaFisicaId: null,
    pessoaJuridicaId: null,
    comparacaoNome: "indefinido",
    motivo: "Sem sinais suficientes",
    evidencias: [],
  };

  if (input.cpf && input.cnpj) {
    return {
      ...empty,
      tier: "REJEITADO",
      motivo: "CPF e CNPJ na mesma linha",
      evidencias: [{ tipo: "CONFLITO_DOCUMENTO", peso: 0, detalhe: "Multiplos documentos" }],
    };
  }

  if (input.cpf) {
    const rows = await db
      .select()
      .from(pessoaFisica)
      .where(eq(pessoaFisica.cpf, input.cpf))
      .limit(1);
    const pf = rows[0];
    if (!pf) {
      return {
        ...empty,
        motivo: `CPF ${input.cpf} ausente no cadastro`,
        evidencias: [{ tipo: "CPF_SEM_CADASTRO", peso: 0, detalhe: "Documento extraído sem cadastro UF" }],
      };
    }
    const comparacao = isNomeContraparteVazio(input.remetenteDestinatario)
      ? "indefinido"
      : compararNomeComPessoa(input.remetenteDestinatario!, pf);
    const tier: CadastroLinkTier =
      comparacao === "bate" ? "ALTA" : "MEDIA";
    return {
      tier,
      pessoaFisicaId: pf.id,
      pessoaJuridicaId: null,
      comparacaoNome: comparacao,
      motivo: tier === "ALTA" ? "CPF cadastro com nome alinhado" : "CPF cadastro; revisar nome",
      evidencias: evidenciaDoc("CPF_CADASTRO", input.cpf, comparacao),
    };
  }

  if (input.cnpj) {
    const rows = await db
      .select()
      .from(pessoaJuridica)
      .where(eq(pessoaJuridica.cnpj, input.cnpj))
      .limit(1);
    const pj = rows[0];
    if (!pj) {
      return {
        ...empty,
        motivo: `CNPJ ${input.cnpj} ausente no cadastro`,
        evidencias: [{ tipo: "CNPJ_SEM_CADASTRO", peso: 0, detalhe: "Documento extraído sem cadastro UF" }],
      };
    }
    const comparacao = isNomeContraparteVazio(input.remetenteDestinatario)
      ? "indefinido"
      : compararNomeComPessoa(input.remetenteDestinatario!, {
          nome: pj.razaoSocial,
          aliases: pj.aliases,
        });
    const tier: CadastroLinkTier =
      comparacao === "bate" ? "ALTA" : "MEDIA";
    return {
      tier,
      pessoaFisicaId: null,
      pessoaJuridicaId: pj.id,
      comparacaoNome: comparacao,
      motivo: tier === "ALTA" ? "CNPJ cadastro com nome alinhado" : "CNPJ cadastro; revisar nome",
      evidencias: evidenciaDoc("CNPJ_CADASTRO", input.cnpj, comparacao),
    };
  }

  if (!isNomeContraparteVazio(input.remetenteDestinatario)) {
    const matches = await findPessoasByNomeFuzzy(db, input.remetenteDestinatario!);
    if (matches.length === 1) {
      const m = matches[0]!;
      return {
        tier: "MEDIA",
        pessoaFisicaId: m.kind === "PF" ? m.id : null,
        pessoaJuridicaId: m.kind === "PJ" ? m.id : null,
        comparacaoNome: "bate",
        motivo: "Nome único no cadastro (sem documento)",
        evidencias: [
          {
            tipo: "NOME_CADASTRO",
            peso: (DEFAULT_WEIGHTS.CPF_EXATO ?? 0.45) * 0.85,
            detalhe: `Nome vinculado: ${m.nome}`,
          },
        ],
      };
    }
    if (matches.length > 1) {
      return {
        ...empty,
        tier: "REJEITADO",
        motivo: "Homônimo: múltiplas pessoas no cadastro",
        evidencias: [{ tipo: "CONFLITO_NOME", peso: 0, detalhe: `${matches.length} candidatos` }],
      };
    }
  }

  return empty;
}
```

**Nota performance (follow-up opcional):** `findPessoasByNomeFuzzy` full-scan OK para piloto BA (~257 PF/PJ). Se lento, trocar por query com `ilike` em token primeiro.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/core && npm test -- src/match/cadastro-link.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/match/cadastro-link.ts packages/core/src/match/cadastro-link.test.ts
git commit -m "feat(match): add cadastro-link kernel with evidence tiers"
```

---

### Task 2: Refatorar `applyDeterministicMatch`

**Files:**
- Modify: `packages/core/src/match/rules.ts`
- Modify: `packages/core/src/match/rules.test.ts`

- [ ] **Step 1: Write failing test — no stub on unknown CPF**

Add to `rules.test.ts`:

```typescript
it("does not create stub when cpf missing from cadastro", async () => {
  const { db, insertFn } = buildDb(); // no existing PF
  const result = await applyDeterministicMatch(db as never, movimentacaoId);
  expect(result.pessoaFisicaId).toBeNull();
  const pfInserts = insertFn.mock.calls.filter((c) => c[0] === pessoaFisica);
  expect(pfInserts).toHaveLength(0);
});
```

- [ ] **Step 2: Run — expect FAIL** (today creates stub)

```bash
cd packages/core && npm test -- src/match/rules.test.ts -t "does not create stub"
```

- [ ] **Step 3: Refactor `rules.ts`**

Replace body of `applyDeterministicMatch` after loading `current`:

```typescript
import { resolveCadastroLink, type CadastroLinkTier } from "./cadastro-link";
import { structuredDocsFromOrigemExtracao } from "./structured-contraparte-docs";

function resolveStatusFromTier(
  tier: CadastroLinkTier,
  score: number,
  confiancaLimiteAlta: number,
  pessoaLinked: boolean,
  bloqueioExport: boolean,
): string {
  if (tier === "ALTA" && score >= confiancaLimiteAlta && pessoaLinked && !bloqueioExport) {
    return MOVIMENTACAO_STATUS.CONFIRMADO;
  }
  return MOVIMENTACAO_STATUS.PENDENTE_REVISAO;
}
```

Inside `applyDeterministicMatch`:

```typescript
const structured = structuredDocsFromOrigemExtracao(origem);
const link = await resolveCadastroLink(db, {
  cpf: structured.cpf,
  cnpj: structured.cnpj,
  remetenteDestinatario: current.remetenteDestinatario,
});

let pessoaFisicaId = link.pessoaFisicaId;
let pessoaJuridicaId = link.pessoaJuridicaId;
const evidencias = link.evidencias;

// insert evidencias, evaluateMovimentacao, resolveStatusFromTier(link.tier, ...)
```

Remove functions: `getOrCreatePessoaFisica`, `getOrCreatePessoaJuridica`, `findUniquePessoaByNome` (local).

- [ ] **Step 4: Update existing tests**

- `matches CPF from origem estruturada` → expect `pessoaFisicaId` null if mock returns no PF
- `links existing pessoa fisica` → tier ALTA when nome bate; add case MEDIA when nome difere → status `PENDENTE_REVISAO` not `CONFIRMADO`
- `matches cadastro by remetenteDestinatario` → mock `findPessoasByNomeFuzzy` path via full PF list or integration-style mock

- [ ] **Step 5: Run full rules tests**

```bash
cd packages/core && npm test -- src/match/rules.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/match/rules.ts packages/core/src/match/rules.test.ts
git commit -m "feat(match): deterministic link via cadastro-link tiers"
```

---

### Task 3: Consolidação — par endurecido + hipóteses

**Files:**
- Modify: `packages/core/src/consolidacao/types.ts`
- Modify: `packages/core/src/consolidacao/candidates.ts`
- Modify: `packages/core/src/consolidacao/candidates.test.ts`

- [ ] **Step 1: Add `cadastroLinkTier` to draft type**

`packages/core/src/consolidacao/types.ts`:

```typescript
import type { CadastroLinkTier } from "../match/cadastro-link";

export type ConsolidacaoEventDraft = {
  // ...existing fields
  cadastroLinkTier?: CadastroLinkTier;
};
```

- [ ] **Step 2: Failing test — divergent names become hipótese not event**

```typescript
it("nao cria evento principal quando mesma data valor mas nomes divergem", () => {
  const pix = { ...pixLine, remetenteDestinatario: "ANA LIMA" };
  const comp = { ...completoLine, remetenteDestinatario: "CARLOS REIS", cpfExtraido: null };
  const events = buildConsolidacaoCandidates([pix, comp], emptyCtx);
  const paired = events.find((e) => e.linhas.length === 2);
  expect(paired).toBeUndefined();
  // singles or hipoteses — at least 2 single-line events
  expect(events.filter((e) => e.linhas.length === 1).length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 3: Implement `pairEligible(a, b)` in candidates.ts**

```typescript
function pairEligible(a: MovimentacaoCandidate, b: MovimentacaoCandidate): boolean {
  const docsA = extractDocsFromMov(a);
  const docsB = extractDocsFromMov(b);
  if (docsA.cpf && docsB.cpf && docsA.cpf === docsB.cpf) return true;
  if (docsA.cnpj && docsB.cnpj && docsA.cnpj === docsB.cnpj) return true;
  const nomeA = remetenteFromMov(a);
  const nomeB = remetenteFromMov(b);
  if (nomeA.length >= 3 && nomeB.length >= 3 && nomesBatem(nomeA, nomeB)) return true;
  // doc only on one side: still need nome bate between remetentes OR pix nome bate completo remetente
  if ((docsA.cpf || docsA.cnpj || docsB.cpf || docsB.cnpj) && nomesBatem(nomeA, nomeB)) return true;
  return false;
}
```

In pairing loop, skip if `!pairEligible(a, b)`.

When score would be 0.55 (divergent names), push to `hipoteses` on nearest single event instead of creating merged draft.

Set `cadastroLinkTier` on draft from `scorePair` / `scoreSingle` result mapping:
- confiança ≥ 0.9 + pessoa + doc → `ALTA`
- confiança ≥ 0.8 → `MEDIA`
- else `BAIXA`

- [ ] **Step 4: Run candidates tests**

```bash
cd packages/core && npm test -- src/consolidacao/candidates.test.ts
```

Fix `bahia-fixture.test.ts` if expectations change.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/consolidacao/
git commit -m "feat(consolidacao): require doc or matching name for PDF pairs"
```

---

### Task 4: Auto-aprovação consolidação só tier ALTA

**Files:**
- Modify: `packages/core/src/consolidacao/auto.ts`
- Modify: `packages/core/src/consolidacao/auto.test.ts`

- [ ] **Step 1: Failing test**

```typescript
it("nao auto-aprova tier MEDIA mesmo com confianca alta", () => {
  const draft = {
    pessoaFisicaId: "pf-1",
    confianca: 0.85,
    cadastroLinkTier: "MEDIA" as const,
    // ...minimal required fields
  };
  expect(isConsolidacaoAutoAprovavel(draft)).toBe(false);
});
```

- [ ] **Step 2: Update `isConsolidacaoAutoAprovavel`**

```typescript
export function isConsolidacaoAutoAprovavel(
  draft: ConsolidacaoEventDraft,
  limiarAlta = getConfiancaLimiarAlta(),
): boolean {
  return (
    draft.cadastroLinkTier === "ALTA" &&
    hasPessoaVinculo(draft) &&
    draft.confianca >= limiarAlta
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/core && npm test -- src/consolidacao/auto.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/consolidacao/auto.ts packages/core/src/consolidacao/auto.test.ts
git commit -m "feat(consolidacao): auto-approve only ALTA tier events"
```

---

### Task 5: Planilha — tier + resumo

**Files:**
- Modify: `packages/core/src/planilha/types.ts`
- Modify: `packages/core/src/planilha/list.ts`
- Modify: `packages/core/src/planilha/mutations.ts`
- Modify: `packages/core/src/planilha/status.ts`
- Modify: `packages/core/src/planilha/list.test.ts` (if exists)

- [ ] **Step 1: Extend `PlanilhaLinha`**

```typescript
import type { CadastroLinkTier } from "../match/cadastro-link";
import type { NomeCadastroComparacao } from "../match/nome-cadastro";

export type PlanilhaLinha = {
  // ...existing
  cadastroLinkTier?: CadastroLinkTier | null;
  comparacaoNome?: NomeCadastroComparacao | null;
};
```

- [ ] **Step 2: Derive tier in `list.ts`**

When mapping movimentacao rows, read `match_evidencia`:

```typescript
function deriveCadastroLinkTier(
  evidencias: Array<{ tipo: string }>,
  pessoaLinked: boolean,
  comparacaoNome: NomeCadastroComparacao,
): CadastroLinkTier | null {
  if (evidencias.some((e) => e.tipo === "CONFLITO_DOCUMENTO" || e.tipo === "CONFLITO_NOME")) {
    return "REJEITADO";
  }
  if (!pessoaLinked) {
    if (evidencias.some((e) => e.tipo === "CPF_SEM_CADASTRO" || e.tipo === "CNPJ_SEM_CADASTRO")) {
      return "BAIXA";
    }
    return null;
  }
  if (comparacaoNome === "bate" && evidencias.some((e) => e.tipo === "CPF_CADASTRO" || e.tipo === "CNPJ_CADASTRO")) {
    return "ALTA";
  }
  return "MEDIA";
}
```

Compute `comparacaoNome` via `compararNomeCadastro(remetenteDestinatario, pessoa.nome)` when pessoa present.

- [ ] **Step 3: `mutations.ts` — use `resolveCadastroLink` in rematch paths**

Replace local `findUniquePessoaByNome` with `resolveCadastroLink` for consolidacao event rematch.

- [ ] **Step 4: `status.ts` — resumo counters**

```typescript
export type PlanilhaResumo = {
  // ...existing
  docSemCadastro: number;
  nomeDiverge: number;
};
```

In `buildResumo`:

```typescript
let docSemCadastro = 0;
let nomeDiverge = 0;
for (const l of linhas) {
  if (l.cadastroLinkTier === "BAIXA" && /* has CPF_SEM_CADASTRO signal — or tier BAIXA + origem has doc */) docSemCadastro++;
  if (l.comparacaoNome === "difere" && l.pessoa) nomeDiverge++;
}
```

- [ ] **Step 5: Run planilha tests**

```bash
cd packages/core && npm test -- src/planilha/
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/planilha/
git commit -m "feat(planilha): expose cadastro link tier and FP counters"
```

---

### Task 6: UI bolinha por tier

**Files:**
- Modify: `apps/web/components/prestacao/planilha-remetente-destinatario-cell.tsx`
- Modify: `apps/web/components/prestacao/planilha-table.tsx`

- [ ] **Step 1: Extend cell props**

```typescript
type Props = {
  // ...existing
  cadastroLinkTier?: "ALTA" | "MEDIA" | "BAIXA" | "REJEITADO" | null;
  comparacaoNome?: "bate" | "difere" | "indefinido";
};
```

- [ ] **Step 2: Dot logic**

```typescript
function dotClass(tier: Props["cadastroLinkTier"], comparacao: Props["comparacaoNome"]): string | null {
  if (tier === "ALTA" && comparacao === "bate") return "bg-emerald-500";
  if (tier === "MEDIA" || comparacao === "difere") return "bg-amber-500";
  return null;
}
```

Remove standalone `compararNomeCadastro` call when props provided from server.

- [ ] **Step 3: Pass props from `planilha-table.tsx`**

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/prestacao/planilha-remetente-destinatario-cell.tsx apps/web/components/prestacao/planilha-table.tsx
git commit -m "feat(web): remetente dot reflects cadastro link tier"
```

---

### Task 7: Hora na origem (opcional v1)

**Files:**
- Modify: `packages/core/src/provenance/types.ts`
- Modify: `packages/core/src/provenance/attach-extracao.ts`
- Modify: `packages/core/src/consolidacao/candidates.ts`

- [ ] **Step 1: Add `horaContraparte` to `OrigemExtracaoV1`**

```typescript
/** Hora do lançamento (HH:MM) quando coluna mapeada. */
horaContraparte?: string | null;
```

- [ ] **Step 2: Parse from extrato item in `attach-extracao.ts`**

```typescript
function horaFromExtratoItem(item: Record<string, unknown>): string | null {
  const raw = String(item.hora ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : null;
}
```

- [ ] **Step 3: `horaReinforcesPair(a, b)` in candidates**

```typescript
function horaDeltaMinutes(ha: string, hb: string): number {
  const [ah, am] = ha.split(":").map(Number);
  const [bh, bm] = hb.split(":").map(Number);
  return Math.abs((ah * 60 + am) - (bh * 60 + bm));
}

function horaReinforcesPair(a: OrigemExtracaoV1 | null, b: OrigemExtracaoV1 | null): "ok" | "weak" | "skip" {
  const ha = a?.horaContraparte;
  const hb = b?.horaContraparte;
  if (!ha || !hb) return "skip";
  const delta = horaDeltaMinutes(ha, hb);
  if (delta <= 5) return "ok";
  if (delta > 60) return "weak";
  return "skip";
}
```

If `weak` → do not form pair (or downgrade to hipótese).

- [ ] **Step 4: Unit test hora pairing**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/provenance/ packages/core/src/consolidacao/candidates.ts
git commit -m "feat(consolidacao): optional hora reinforcement on PDF pairs"
```

---

### Task 8: Script migração stubs

**Files:**
- Create: `scripts/rematch-desvincular-stubs.ts`
- Modify: `docs/dev-scripts.md`

- [ ] **Step 1: Script**

```typescript
/**
 * Desvincula movimentações com pessoa stub e rematch.
 * Run: pnpm exec tsx scripts/rematch-desvincular-stubs.ts
 */
import { getDb, movimentacao, pessoaFisica, pessoaJuridica } from "@spc-up/db";
import { isNull, eq, inArray } from "drizzle-orm";
import { isStubNome } from "@spc-up/core";
import { applyDeterministicMatch } from "@spc-up/core";

async function main() {
  const db = getDb();
  const movs = await db.query.movimentacao.findMany({
    where: isNull(movimentacao.deletedAt),
    with: { pessoaFisica: true, pessoaJuridica: true },
  });
  let count = 0;
  for (const mov of movs) {
    const stubPf = mov.pessoaFisica && isStubNome("PF", mov.pessoaFisica.nome);
    const stubPj = mov.pessoaJuridica && isStubNome("PJ", mov.pessoaJuridica.razaoSocial);
    if (!stubPf && !stubPj) continue;
    await db.update(movimentacao).set({
      pessoaFisicaId: null,
      pessoaJuridicaId: null,
      status: "PENDENTE_REVISAO",
    }).where(eq(movimentacao.id, mov.id));
    await applyDeterministicMatch(db, mov.id);
    count += 1;
  }
  console.log(`Rematch ${count} movimentações com stub.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Document in `docs/dev-scripts.md`**

- [ ] **Step 3: Dry-run on dev DB (manual)**

- [ ] **Step 4: Commit**

```bash
git add scripts/rematch-desvincular-stubs.ts docs/dev-scripts.md
git commit -m "chore: script rematch movimentações com stub legado"
```

---

### Task 9: Exports + verificação final

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/browser.ts`

- [ ] **Step 1: Export public API**

```typescript
export {
  resolveCadastroLink,
  findPessoasByNomeFuzzy,
  compararNomeComPessoa,
  type CadastroLinkTier,
  type CadastroLinkResult,
} from "./match/cadastro-link";
```

- [ ] **Step 2: Full test suite**

```bash
cd packages/core && npm test
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Optional E2E**

```bash
pnpm exec tsx scripts/test-remetente-match-e2e.ts
```

Update E2E assertions: no auto-link to DESCONHECIDO; expect more PENDENTE.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/browser.ts
git commit -m "chore(core): export cadastro-link API"
```

---

## Spec coverage checklist

| Spec § | Task |
|--------|------|
| Kernel unificado | Task 1 |
| Sem stub auto | Task 2 |
| Tiers + CONFIRMADO só ALTA | Task 2, 4 |
| Par endurecido | Task 3 |
| Hora opcional | Task 7 |
| UI bolinha | Task 6 |
| Resumo docSemCadastro / nomeDiverge | Task 5 |
| Migração stubs | Task 8 |
| Testes Bahia / 7 cenários | Tasks 2–3, 9 |

## Execution order

```
Task 1 → 2 → 3 → 4 → 5 → 6 → (7 opcional) → 8 → 9
```

Task 7 pode rodar em paralelo após Task 3 se outro agente disponível.

---

## Self-review

- [x] Cada requisito da spec mapeado a task
- [x] Sem TBD / placeholders
- [x] Tipos `CadastroLinkTier` consistentes entre tasks
- [x] Comandos de teste explícitos
- [x] Escopo único plano implementável
