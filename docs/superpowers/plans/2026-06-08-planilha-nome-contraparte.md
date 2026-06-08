# Planilha — Nome contraparte e match PF/PJ — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir coluna **Nome** editável na planilha unificada e usá-la como fonte de match por nome no cadastro UF, com persistência em `nome_contraparte`.

**Architecture:** Migration adiciona `nome_contraparte` em `movimentacao` e `consolidacao_evento`. Módulo `match/nome-contraparte.ts` centraliza extração (regra D) e `nomeEffective`. Ingest materializa na criação; `applyDeterministicMatch` e PATCH da planilha consomem o mesmo helper. UI: célula inline + filtro "Sem nome".

**Tech Stack:** TypeScript, Vitest (`packages/core`), Drizzle (`@spc-up/db`), Next.js App Router (`apps/web`).

**Spec:** [2026-06-08-planilha-nome-contraparte-design.md](../specs/2026-06-08-planilha-nome-contraparte-design.md)

---

## Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/db/drizzle/0011_nome_contraparte.sql` | Criar — migration |
| `packages/db/drizzle/meta/_journal.json` | Modificar |
| `packages/db/src/schema.ts` | Modificar — colunas |
| `packages/core/src/match/nome-contraparte.ts` | Criar — extract + derive regra D |
| `packages/core/src/match/nome-contraparte.test.ts` | Criar |
| `packages/core/src/match/rules.ts` | Modificar — match por nome usa nomeEffective |
| `packages/core/src/match/rules.test.ts` | Modificar |
| `packages/core/src/ingest/types.ts` | Modificar — `ParsedTransactionRow.nomeContraparte?` |
| `packages/core/src/ingest/ofx.ts` | Modificar — persist `nome_contraparte` |
| `packages/core/src/ingest/pdf.ts` | Modificar — preencher na row |
| `packages/core/src/consolidacao/candidates.ts` | Modificar — importar helper compartilhado |
| `packages/core/src/consolidacao/persist.ts` | Modificar — gravar no evento |
| `packages/core/src/consolidacao/approve.ts` | Modificar — copiar para canônica |
| `packages/core/src/planilha/types.ts` | Modificar — `nome`, `nomeContraparte`, `semNome` |
| `packages/core/src/planilha/list.ts` | Modificar — mapear campos |
| `packages/core/src/planilha/status.ts` | Modificar — contador `semNome` |
| `packages/core/src/planilha/mutations.ts` | Modificar — `updatePlanilhaLinhaNome` |
| `packages/core/src/planilha/mutations.test.ts` | Modificar |
| `packages/core/src/index.ts` | Modificar — exports |
| `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts` | Modificar — body `nomeContraparte` |
| `apps/web/components/prestacao/planilha-nome-cell.tsx` | Criar |
| `apps/web/components/prestacao/planilha-table.tsx` | Modificar — coluna + filtro |
| `apps/web/components/prestacao/planilha-toolbar.tsx` | Modificar — chip Sem nome |

---

### Task 1: Migration `nome_contraparte`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0011_nome_contraparte.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

- [ ] **Step 1: Adicionar colunas no schema Drizzle**

Em `packages/db/src/schema.ts`, dentro de `movimentacao`:

```typescript
nomeContraparte: varchar("nome_contraparte", { length: 255 }),
```

Dentro de `consolidacaoEvento`:

```typescript
nomeContraparte: varchar("nome_contraparte", { length: 255 }),
```

- [ ] **Step 2: Criar SQL migration**

`packages/db/drizzle/0011_nome_contraparte.sql`:

```sql
ALTER TABLE "movimentacao" ADD COLUMN "nome_contraparte" varchar(255);
ALTER TABLE "consolidacao_evento" ADD COLUMN "nome_contraparte" varchar(255);
```

Atualizar `_journal.json` com entrada `0011_nome_contraparte`.

- [ ] **Step 3: Aplicar migration local**

```bash
cd packages/db && npm run db:migrate
```

Expected: migration aplicada sem erro.

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): add nome_contraparte to movimentacao and evento"
```

---

### Task 2: Helpers `extractNomeContraparte` e `deriveNomeContraparte`

**Files:**
- Create: `packages/core/src/match/nome-contraparte.ts`
- Create: `packages/core/src/match/nome-contraparte.test.ts`

- [ ] **Step 1: Escrever testes falhando**

`packages/core/src/match/nome-contraparte.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  extractNomeContraparte,
  deriveNomeContraparte,
  isNomeContraparteVazio,
} from "./nome-contraparte";

describe("extractNomeContraparte", () => {
  it("remove prefixo bancário e documento", () => {
    expect(
      extractNomeContraparte("CRED PIX GABRIEL REIS DA SILVA CPF 12345678909"),
    ).toBe("GABRIEL REIS DA SILVA");
  });

  it("retorna vazio para só CRED PIX", () => {
    expect(extractNomeContraparte("CRED PIX")).toBe("");
  });

  it("extrai nome-only PIX", () => {
    expect(extractNomeContraparte("GABRIEL REIS DA SILVA")).toBe("GABRIEL REIS DA SILVA");
  });
});

describe("deriveNomeContraparte regra D", () => {
  it("prefere nome PIX quando completo tem doc", () => {
    expect(
      deriveNomeContraparte([
        { descricaoRaw: "GABRIEL REIS DA SILVA", papel: "PIX" },
        {
          descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
          papel: "COMPLETO",
        },
      ]),
    ).toBe("GABRIEL REIS DA SILVA");
  });

  it("usa completo quando PIX sem nome", () => {
    expect(
      deriveNomeContraparte([
        { descricaoRaw: "CRED PIX", papel: "PIX" },
        {
          descricaoRaw: "GABRIEL REIS DA SILVA CPF 12345678901",
          papel: "COMPLETO",
        },
      ]),
    ).toBe("GABRIEL REIS DA SILVA");
  });
});

describe("isNomeContraparteVazio", () => {
  it("true para string curta ou vazia", () => {
    expect(isNomeContraparteVazio("")).toBe(true);
    expect(isNomeContraparteVazio("PIX")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar teste — deve falhar**

```bash
cd packages/core && npm test -- src/match/nome-contraparte.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implementar**

`packages/core/src/match/nome-contraparte.ts`:

```typescript
import { normalizeName } from "../normalize";
import {
  cleanNomeSugestao,
  extractDocumentCandidates,
  findCnpjInDescricao,
  findCpfInDescricao,
} from "./rules";

export type OrigemNomeInput = {
  descricaoRaw: string;
  papel?: string;
};

const MIN_NOME_LEN = 3;

export function extractNomeContraparte(descricaoRaw: string): string {
  const doc =
    findCpfInDescricao(descricaoRaw) ?? findCnpjInDescricao(descricaoRaw) ?? "";
  const cleaned = cleanNomeSugestao(descricaoRaw, doc);
  return normalizeName(cleaned);
}

export function isNomeContraparteVazio(nome: string): boolean {
  return nome.trim().length < MIN_NOME_LEN;
}

export function deriveNomeContraparte(origens: OrigemNomeInput[]): string {
  const pix = origens.find((o) => o.papel === "PIX");
  const completo = origens.find((o) => o.papel === "COMPLETO");

  const nomePix = pix ? extractNomeContraparte(pix.descricaoRaw) : "";
  const nomeCompleto = completo
    ? extractNomeContraparte(completo.descricaoRaw)
    : "";

  const completoTemDoc =
    !!completo &&
    extractDocumentCandidates(completo.descricaoRaw).length > 0;

  if (!isNomeContraparteVazio(nomePix) && completoTemDoc) {
    return nomePix;
  }
  if (!isNomeContraparteVazio(nomeCompleto)) {
    return nomeCompleto;
  }
  if (!isNomeContraparteVazio(nomePix)) {
    return nomePix;
  }

  let best = "";
  for (const o of origens) {
    const n = extractNomeContraparte(o.descricaoRaw);
    if (n.length > best.length) {
      best = n;
    }
  }
  return best;
}

export function resolveNomeEffective(
  persistido: string | null | undefined,
  origens: OrigemNomeInput[],
): string {
  if (persistido && !isNomeContraparteVazio(persistido)) {
    return normalizeName(persistido);
  }
  return deriveNomeContraparte(origens);
}
```

- [ ] **Step 4: Rodar teste — deve passar**

```bash
cd packages/core && npm test -- src/match/nome-contraparte.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/match/nome-contraparte.ts packages/core/src/match/nome-contraparte.test.ts
git commit -m "feat(core): nome contraparte extract and derive helpers"
```

---

### Task 3: Refatorar `applyDeterministicMatch` para usar nome efetivo

**Files:**
- Modify: `packages/core/src/match/rules.ts`
- Modify: `packages/core/src/match/rules.test.ts`

- [ ] **Step 1: Adicionar teste — match por nome usa nome_contraparte, não descricaoRaw com lixo**

Em `rules.test.ts`:

```typescript
it("matches cadastro by nome_contraparte when descricaoRaw is only CRED PIX", async () => {
  const db = await setupDbWithPessoa({ nome: "MARIA SILVA", cpf: "12345678901" });
  const mov = await insertMov({
    descricaoRaw: "CRED PIX",
    nomeContraparte: "MARIA SILVA",
  });
  const result = await applyDeterministicMatch(db, mov.id);
  expect(result.pessoaFisicaId).toBeTruthy();
});
```

(Ajustar helpers de teste existentes no arquivo.)

- [ ] **Step 2: Rodar — deve falhar**

```bash
cd packages/core && npm test -- src/match/rules.test.ts -t "nome_contraparte"
```

- [ ] **Step 3: Alterar `applyDeterministicMatch`**

Após carregar `current`, antes do bloco `findUniquePessoaByNome`:

```typescript
import { extractNomeContraparte, isNomeContraparteVazio } from "./nome-contraparte";

// ...

} else if (cpfs.length === 0 && cnpjs.length === 0) {
  const nomeParaMatch =
    current.nomeContraparte && !isNomeContraparteVazio(current.nomeContraparte)
      ? current.nomeContraparte
      : extractNomeContraparte(current.descricaoRaw);

  if (!isNomeContraparteVazio(nomeParaMatch)) {
    const byNome = await findUniquePessoaByNome(db, nomeParaMatch);
    // ... resto igual
  }
}
```

- [ ] **Step 4: Rodar testes match**

```bash
cd packages/core && npm test -- src/match/rules.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/match/rules.ts packages/core/src/match/rules.test.ts
git commit -m "feat(match): use nome_contraparte for cadastro nome match"
```

---

### Task 4: Ingest — materializar `nome_contraparte` na criação

**Files:**
- Modify: `packages/core/src/ingest/ofx.ts`
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/consolidacao/persist.ts`
- Modify: `packages/core/src/consolidacao/candidates.ts`

- [ ] **Step 1: `persistTransactions` grava coluna**

`packages/core/src/ingest/ofx.ts` — importar `extractNomeContraparte`, `isNomeContraparteVazio`.

No `.values({...})` do insert:

```typescript
nomeContraparte: (() => {
  const fromRow = row.nomeContraparte;
  if (fromRow && !isNomeContraparteVazio(fromRow)) return fromRow;
  const extracted = extractNomeContraparte(row.descricaoRaw);
  return isNomeContraparteVazio(extracted) ? null : extracted;
})(),
```

- [ ] **Step 2: `rowFromExtratoItem` pré-calcula quando possível**

Em `pdf.ts`, nos returns de `ParsedTransactionRow`, adicionar opcional:

```typescript
nomeContraparte: (() => {
  const n = extractNomeContraparte(descricaoRaw);
  return isNomeContraparteVazio(n) ? undefined : n;
})(),
```

- [ ] **Step 3: `persistConsolidacaoDrafts` grava no evento**

```typescript
import { deriveNomeContraparte, isNomeContraparteVazio } from "../match/nome-contraparte";

// dentro do loop, antes do insert:
const origensNome = draft.linhas.map((l) => ({
  descricaoRaw: /* buscar descricaoRaw da mov no draft ou passar no ConsolidacaoLinhaDraft */,
  papel: l.papel,
}));
```

**Nota:** Se `ConsolidacaoLinhaDraft` não tem `descricaoRaw`, estender draft em `candidates.ts` / `types.ts` com `descricaoRaw` (já disponível em `MovimentacaoCandidate` ao montar draft).

```typescript
nomeContraparte: (() => {
  const derived = deriveNomeContraparte(origensNome);
  return isNomeContraparteVazio(derived) ? null : derived;
})(),
```

- [ ] **Step 4: Deduplicar `nomeFromDescricao` em candidates**

Substituir função local por `extractNomeContraparte` importado.

- [ ] **Step 5: Testes**

```bash
cd packages/core && npm test -- src/consolidacao/bahia-fixture.test.ts src/ingest/pdf.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ingest/ packages/core/src/consolidacao/
git commit -m "feat(ingest): persist nome_contraparte on create"
```

---

### Task 5: Approve merge copia nome para canônica

**Files:**
- Modify: `packages/core/src/consolidacao/approve.ts`

- [ ] **Step 1: Estender update da movimentação canônica**

No `.set({...})` de `approveConsolidacaoEvento`:

```typescript
nomeContraparte: evento.nomeContraparte,
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/consolidacao/approve.ts
git commit -m "feat(consolidacao): copy nome_contraparte on approve"
```

---

### Task 6: Adapter planilha — tipos, list, resumo

**Files:**
- Modify: `packages/core/src/planilha/types.ts`
- Modify: `packages/core/src/planilha/list.ts`
- Modify: `packages/core/src/planilha/status.ts`
- Modify: `packages/core/src/planilha/list.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Estender tipos**

`PlanilhaLinha`:

```typescript
nome: string;
nomeContraparte: string | null;
nomeDerivado: boolean;
```

`PlanilhaResumo`:

```typescript
semNome: number;
```

- [ ] **Step 2: Mapear em `mapConsolidacaoEventoToLinha` / `mapMovimentacaoToLinha`**

```typescript
import { resolveNomeEffective, isNomeContraparteVazio } from "../match/nome-contraparte";

function buildNomeFields(
  persistido: string | null | undefined,
  origens: PlanilhaOrigem[],
): Pick<PlanilhaLinha, "nome" | "nomeContraparte" | "nomeDerivado"> {
  const origensInput = origens.map((o) => ({
    descricaoRaw: o.descricaoRaw,
    papel: o.papel,
  }));
  const nome = resolveNomeEffective(persistido, origensInput);
  const derivado = !persistido || isNomeContraparteVazio(persistido);
  return {
    nome,
    nomeContraparte: persistido ?? null,
    nomeDerivado: derivado && !isNomeContraparteVazio(nome),
  };
}
```

Incluir `nomeContraparte` nos inputs de consolidacao/movimentacao (queries já retornam mov — adicionar coluna no select).

- [ ] **Step 3: `buildResumo` conta `semNome`**

```typescript
if (isNomeContraparteVazio(l.nome)) semNome++;
```

- [ ] **Step 4: Testes list**

```bash
cd packages/core && npm test -- src/planilha/
```

- [ ] **Step 5: Export em `index.ts`**

```typescript
export {
  extractNomeContraparte,
  deriveNomeContraparte,
  resolveNomeEffective,
  isNomeContraparteVazio,
} from "./match/nome-contraparte";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/planilha/ packages/core/src/index.ts
git commit -m "feat(planilha): expose nome fields and semNome resumo"
```

---

### Task 7: Mutação `updatePlanilhaLinhaNome` + re-match condicional

**Files:**
- Modify: `packages/core/src/planilha/mutations.ts`
- Modify: `packages/core/src/planilha/mutations.test.ts`

- [ ] **Step 1: Teste — salvar nome com PF vazio dispara match**

- [ ] **Step 2: Implementar**

```typescript
export async function updatePlanilhaLinhaNome(
  db: Db,
  linhaId: string,
  fonte: PlanilhaLinhaFonte,
  nomeContraparte: string | null,
): Promise<void> {
  const normalized =
    nomeContraparte && !isNomeContraparteVazio(nomeContraparte)
      ? normalizeName(nomeContraparte)
      : null;

  if (fonte === "movimentacao") {
    await db
      .update(movimentacao)
      .set({ nomeContraparte: normalized })
      .where(eq(movimentacao.id, linhaId));

    const mov = await db.query.movimentacao.findFirst({
      where: eq(movimentacao.id, linhaId),
      columns: { pessoaFisicaId: true, pessoaJuridicaId: true },
    });
    if (!mov?.pessoaFisicaId && !mov?.pessoaJuridicaId) {
      await applyDeterministicMatch(db, linhaId);
    }
    return;
  }

  await db
    .update(consolidacaoEvento)
    .set({ nomeContraparte: normalized })
    .where(eq(consolidacaoEvento.id, linhaId));

  const evento = await db.query.consolidacaoEvento.findFirst({
    where: eq(consolidacaoEvento.id, linhaId),
    columns: { pessoaFisicaId: true, pessoaJuridicaId: true },
  });
  if (!evento?.pessoaFisicaId && !evento?.pessoaJuridicaId) {
    await rematchConsolidacaoEventoPorNome(db, linhaId); // ou lógica inline findUnique + update evento
  }
}
```

Implementar `rematchConsolidacaoEventoPorNome`: CPF/CNPJ das movimentações filhas primeiro; senão `findUniquePessoaByNome(nomeEffective)` → set `pessoaFisicaId`/`pessoaJuridicaId` no evento.

- [ ] **Step 3: Testes**

```bash
cd packages/core && npm test -- src/planilha/mutations.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/planilha/mutations.ts packages/core/src/planilha/mutations.test.ts
git commit -m "feat(planilha): PATCH nome with conditional rematch"
```

---

### Task 8: API route — aceitar `nomeContraparte`

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts`

- [ ] **Step 1: Estender schema Zod**

```typescript
nomeContraparte: z.string().max(255).nullable().optional(),
```

- [ ] **Step 2: Handler**

```typescript
import { updatePlanilhaLinhaNome, updatePlanilhaLinhaPessoa } from "@spc-up/core";

if ("nomeContraparte" in body) {
  await updatePlanilhaLinhaNome(db, linhaId, fonte, body.nomeContraparte ?? null);
}
if (body.pessoaFisicaId || body.pessoaJuridicaId || body.limparPessoa) {
  await updatePlanilhaLinhaPessoa(db, linhaId, fonte, pessoa);
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/prestacao/sessoes/[id]/planilha/linhas/[linhaId]/route.ts
git commit -m "feat(api): planilha PATCH accepts nomeContraparte"
```

---

### Task 9: UI — célula Nome, coluna, filtro

**Files:**
- Create: `apps/web/components/prestacao/planilha-nome-cell.tsx`
- Modify: `apps/web/components/prestacao/planilha-table.tsx`
- Modify: `apps/web/components/prestacao/planilha-toolbar.tsx`

- [ ] **Step 1: Criar `PlanilhaNomeCell`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { PlanilhaLinhaFonte } from "@spc-up/core";
import { Input } from "@/components/ui/input";

type Props = {
  sessaoId: string;
  linhaId: string;
  fonte: PlanilhaLinhaFonte;
  nome: string;
  disabled?: boolean;
  onUpdated: () => void;
};

export function PlanilhaNomeCell({
  sessaoId,
  linhaId,
  fonte,
  nome,
  disabled,
  onUpdated,
}: Props) {
  const [value, setValue] = useState(nome);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(nome);
  }, [nome]);

  async function save(next: string) {
    const trimmed = next.trim();
    if (trimmed === nome.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linhaId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fonte,
            nomeContraparte: trimmed.length > 0 ? trimmed : null,
          }),
        },
      );
      if (res.ok) onUpdated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Input
      className="h-8 min-w-[10rem] text-xs"
      value={value}
      placeholder="—"
      disabled={disabled || busy}
      title={value || undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
```

- [ ] **Step 2: Coluna em `planilha-table.tsx`**

Header após "Descrição Original": `<th>Nome</th>`

Célula:

```tsx
<PlanilhaNomeCell
  sessaoId={sessaoId}
  linhaId={linha.id}
  fonte={linha.fonte}
  nome={linha.nome}
  onUpdated={() => void refresh()}
  disabled={busy}
/>
```

Atualizar `matchesFilter`:

```typescript
case "sem_nome":
  return !linha.nome || linha.nome.trim().length < 3;
```

`colSpan` +1 na linha vazia.

- [ ] **Step 3: Toolbar — filtro Sem nome**

`planilha-toolbar.tsx`:

```typescript
export type PlanilhaFilter =
  | "todos"
  | "sem_nome"
  | "sem_pessoa"
  // ...

{ id: "sem_nome", label: "Sem nome", count: (r) => r.semNome },
```

- [ ] **Step 4: Verificação manual**

Subir web, abrir planilha Bahia, confirmar coluna Nome + filtro + edição persiste após refresh.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/prestacao/planilha-nome-cell.tsx apps/web/components/prestacao/planilha-table.tsx apps/web/components/prestacao/planilha-toolbar.tsx
git commit -m "feat(web): planilha Nome column and sem nome filter"
```

---

### Task 10: Regressão e fixture Bahia

**Files:**
- Modify: `packages/core/src/consolidacao/bahia-fixture.test.ts` (opcional assert nome)
- Modify: `packages/core/src/planilha/list.test.ts`

- [ ] **Step 1: Rodar suite core**

```bash
cd packages/core && npm test
```

Expected: all PASS

- [ ] **Step 2: Lint**

```bash
cd packages/core && npm run lint
cd apps/web && npm run lint
```

- [ ] **Step 3: Commit final se ajustes**

```bash
git commit -m "test: nome contraparte regressions"
```

---

## Self-review (spec coverage)

| Requisito spec | Task |
|----------------|------|
| Migration `nome_contraparte` | Task 1 |
| Regra D derivação | Task 2 |
| Match usa nome efetivo | Task 3 |
| Ingest materializa | Task 4 |
| Approve copia nome | Task 5 |
| API + tipos planilha | Task 6–8 |
| UI coluna + filtro + blur | Task 9 |
| Re-match só PF/PJ vazio | Task 7 |
| Export não exige nome | Task 6 (sem mudança em `isLinhaPronta`) |
| Testes aceite Bahia | Task 10 |

---

## Execução

Plano salvo em `docs/superpowers/plans/2026-06-08-planilha-nome-contraparte.md`.

**Opções:**

1. **Subagent-Driven (recomendado)** — subagente por task, review entre tasks  
2. **Inline Execution** — executar nesta sessão com checkpoints

Qual abordagem?
