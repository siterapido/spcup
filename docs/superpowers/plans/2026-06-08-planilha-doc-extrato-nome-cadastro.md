# Planilha — Doc. extrato, Nome×cadastro, descrição única — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** (1) capturar o n.º Documento na extração do extrato; (2) comparar nome extraído × nome do cadastro com destaque visual; (3) remover a coluna "Descrição Original" redundante.

**Architecture:** Fix de schema/prompt na camada de extração IA (`packages/core/src/ai/openrouter`). Helper puro `compararNomeCadastro` em `packages/core/src/match`, reexport de `normalizeName` no bundle browser. UI: indicador na célula Nome e remoção de coluna em `planilha-table.tsx`. Sem migration, sem mudança de API.

**Tech Stack:** TypeScript, Vitest (`packages/core`), Next.js App Router (`apps/web`).

**Spec:** [2026-06-08-planilha-doc-extrato-nome-cadastro-design.md](../specs/2026-06-08-planilha-doc-extrato-nome-cadastro-design.md)

---

## Arquivos

| Arquivo | Ação |
|---------|------|
| `apps/web/components/prestacao/planilha-table.tsx` | Modificar — remover coluna "Descrição Original"; passar `pessoaNome`; `colSpan` |
| `apps/web/components/prestacao/planilha-nome-cell.tsx` | Modificar — prop `pessoaNome` + indicador verde/âmbar |
| `packages/core/src/match/nome-cadastro.ts` | Criar — `compararNomeCadastro` |
| `packages/core/src/match/nome-cadastro.test.ts` | Criar |
| `packages/core/src/browser.ts` | Modificar — exportar `normalizeName` |
| `packages/core/src/index.ts` | Modificar — exportar `compararNomeCadastro` |
| `packages/core/src/ai/openrouter/schemas.ts` | Modificar — campo `documento` + prompts |

---

### Task 1: Remover coluna "Descrição Original" (#3)

**Files:**
- Modify: `apps/web/components/prestacao/planilha-table.tsx`

- [ ] **Step 1: Remover header e célula**

Remover `<th className="px-3 py-2">Descrição Original</th>` e a `<td>` que renderiza
`linha.descricaoRaw`. Manter a coluna "Descrição" (`linha.descricao`).

- [ ] **Step 2: Ajustar colSpan da linha-vazia**

`colSpan={13}` → `colSpan={12}`.

- [ ] **Step 3: Verificação manual**

Subir web, abrir planilha; confirmar uma só coluna de descrição e alinhamento de
cabeçalho/linhas correto. Raw segue visível ao expandir "Origens".

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/prestacao/planilha-table.tsx
git commit -m "refactor(web): remove redundant Descricao Original column"
```

---

### Task 2: Helper `compararNomeCadastro` + reexport `normalizeName` (#2 core)

**Files:**
- Create: `packages/core/src/match/nome-cadastro.ts`
- Create: `packages/core/src/match/nome-cadastro.test.ts`
- Modify: `packages/core/src/browser.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Teste falhando**

`packages/core/src/match/nome-cadastro.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { compararNomeCadastro } from "./nome-cadastro";

describe("compararNomeCadastro", () => {
  it("bate em igualdade normalizada (acento/caixa)", () => {
    expect(compararNomeCadastro("João Silva", "JOAO SILVA")).toBe("bate");
  });
  it("bate quando um contém o outro", () => {
    expect(compararNomeCadastro("MARIA SILVA", "MARIA DA SILVA SOUZA")).toBe("bate");
  });
  it("difere quando nomes distintos", () => {
    expect(compararNomeCadastro("ANA LIMA", "CARLOS REIS")).toBe("difere");
  });
  it("indefinido quando extraido vazio/curto", () => {
    expect(compararNomeCadastro("", "MARIA")).toBe("indefinido");
    expect(compararNomeCadastro("PIX", "MARIA")).toBe("indefinido");
  });
  it("indefinido quando cadastro vazio", () => {
    expect(compararNomeCadastro("MARIA SILVA", "")).toBe("indefinido");
  });
});
```

- [ ] **Step 2: Rodar — deve falhar**

```bash
cd packages/core && npm test -- src/match/nome-cadastro.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implementar**

`packages/core/src/match/nome-cadastro.ts`:

```typescript
import { normalizeName } from "../normalize";

export type NomeCadastroComparacao = "bate" | "difere" | "indefinido";

const MIN_NOME_LEN = 3;

export function compararNomeCadastro(
  extraido: string,
  cadastro: string,
): NomeCadastroComparacao {
  const a = normalizeName(extraido ?? "");
  const b = normalizeName(cadastro ?? "");
  if (a.length < MIN_NOME_LEN || b.length < MIN_NOME_LEN) {
    return "indefinido";
  }
  if (a === b || a.includes(b) || b.includes(a)) {
    return "bate";
  }
  return "difere";
}
```

- [ ] **Step 4: Exportar**

`packages/core/src/browser.ts`:

```typescript
export { normalizeName } from "./normalize";
export {
  compararNomeCadastro,
  type NomeCadastroComparacao,
} from "./match/nome-cadastro";
```

`packages/core/src/index.ts`: reexport de `compararNomeCadastro` (seguir padrão dos demais).

- [ ] **Step 5: Rodar — deve passar**

```bash
cd packages/core && npm test -- src/match/nome-cadastro.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/match/nome-cadastro.ts packages/core/src/match/nome-cadastro.test.ts packages/core/src/browser.ts packages/core/src/index.ts
git commit -m "feat(core): compararNomeCadastro helper and browser normalizeName export"
```

---

### Task 3: Indicador Nome×cadastro na célula (#2 UI)

**Files:**
- Modify: `apps/web/components/prestacao/planilha-nome-cell.tsx`
- Modify: `apps/web/components/prestacao/planilha-table.tsx`

- [ ] **Step 1: Prop `pessoaNome` e indicador em `PlanilhaNomeCell`**

Adicionar `pessoaNome?: string | null` às `Props`. Calcular:

```tsx
import { compararNomeCadastro } from "@spc-up/core/browser";

const comparacao = pessoaNome
  ? compararNomeCadastro(value, pessoaNome)
  : "indefinido";
```

Renderizar input + ponto ao lado:
- `bate` → ponto verde (`bg-emerald-500`)
- `difere` → ponto âmbar (`bg-amber-500`)
- `indefinido` → sem ponto

`title` do ponto: `extraído: ${value || "—"} / cadastro: ${pessoaNome}`.
Envolver input+ponto num `flex items-center gap-1.5`. Manter tooltip de nome vazio existente.

- [ ] **Step 2: Passar `pessoaNome` da tabela**

Em `planilha-table.tsx`, na `<PlanilhaNomeCell ... />`:

```tsx
pessoaNome={linha.pessoa?.nome ?? null}
```

- [ ] **Step 3: Verificação manual**

Vincular pessoa numa linha com nome extraído igual → ponto verde; com nome diferente
→ âmbar; linha sem pessoa → sem ponto. Hover mostra "extraído / cadastro".

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/prestacao/planilha-nome-cell.tsx apps/web/components/prestacao/planilha-table.tsx
git commit -m "feat(web): nome extraido vs cadastro match indicator"
```

---

### Task 4: Capturar `documento` na extração (#1)

**Files:**
- Modify: `packages/core/src/ai/openrouter/schemas.ts`

- [ ] **Step 1: Campo `documento` no schema**

Em `EXTRATO_TRANSACTION_ITEM_SCHEMA.properties`:

```typescript
documento: {
  type: ["string", "null"],
  description:
    "Número do Documento/lançamento da transação no extrato (coluna 'Documento'/'Nº Doc'); null se ausente. NÃO é CPF/CNPJ.",
},
```

Adicionar `"documento"` ao array `required`.

- [ ] **Step 2: Atualizar prompts**

Em `KIMI_EXTRATO_SYSTEM_PROMPT` e `GEMINI_EXTRATO_SYSTEM_PROMPT`: incluir
`"documento":"..."` no JSON de exemplo e uma instrução curta
("documento = nº do lançamento/Documento do extrato; não é CPF/CNPJ").

- [ ] **Step 3: Verificar mapeamento existente**

`nrExtratoBancarioFromExtratoItem` já lê `item.documento` — sem mudança. Conferir
testes de `pdf.ts` que montam item com `documento` continuam passando.

```bash
cd packages/core && npm test -- src/ingest/pdf.test.ts src/ai/openrouter/
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/ai/openrouter/schemas.ts
git commit -m "feat(extract): capture documento (nr extrato) from statement"
```

---

### Task 5: Regressão e lint

- [ ] **Step 1: Suite core**

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
git commit -m "test: planilha doc/nome regressions"
```

---

## Self-review (spec coverage)

| Requisito spec | Task |
|----------------|------|
| #1 schema `documento` + prompts | Task 4 |
| #1 mapeamento `nrExtratoBancario` (já existe) | Task 4 (verificação) |
| #2 helper `compararNomeCadastro` (regra A) | Task 2 |
| #2 `normalizeName` no browser | Task 2 |
| #2 indicador verde/âmbar + tooltip | Task 3 |
| #3 remover "Descrição Original" + colSpan | Task 1 |
| Testes de aceite | Task 2, 4, 5 |

---

## Execução

Plano salvo em `docs/superpowers/plans/2026-06-08-planilha-doc-extrato-nome-cadastro.md`.

**Opções:**

1. **Subagent-Driven (recomendado)** — subagente por task, review entre tasks
2. **Inline Execution** — executar nesta sessão com checkpoints

Ordem sugerida: Task 1 → 2 → 3 → 4 → 5 (3 simples primeiro, extração por último).
