# Movimentações aprovadas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reformular `/movimentacoes` como registro consultivo de movimentações `CONFIRMADO`/`EXPORTADO`, filtrável por UF+mês, com paginação server-side, drawer read-only e exports CSV/XLSX/SPCA.

**Architecture:** Novo módulo `@spc-up/core/movimentacoes-aprovadas` centraliza query, resumo e buffers de export. API `/api/movimentacoes` passa a exigir `mes` e paginar; rotas `/api/movimentacoes/export/*` para downloads. UI reescreve `movimentacoes-table.tsx` e adapta `review-drawer` com `readOnly`.

**Tech Stack:** TypeScript, Vitest (`packages/core`), Next.js App Router, Drizzle, ExcelJS (já em `excel-mirror`), archiver (ZIP existente).

**Spec:** [2026-06-08-movimentacoes-aprovadas-design.md](../specs/2026-06-08-movimentacoes-aprovadas-design.md)

---

## Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/core/src/movimentacoes-aprovadas/types.ts` | Criar |
| `packages/core/src/movimentacoes-aprovadas/parse-mes.ts` | Criar — `parseMesFilter` |
| `packages/core/src/movimentacoes-aprovadas/list.ts` | Criar — query paginada |
| `packages/core/src/movimentacoes-aprovadas/export-list.ts` | Criar — CSV + XLSX lista |
| `packages/core/src/movimentacoes-aprovadas/export-espelho.ts` | Criar — espelho SPCA por IDs |
| `packages/core/src/movimentacoes-aprovadas/parse-mes.test.ts` | Criar |
| `packages/core/src/movimentacoes-aprovadas/list.test.ts` | Criar |
| `packages/core/src/index.ts` | Modificar — exports |
| `apps/web/app/api/movimentacoes/route.ts` | Modificar — novo contrato GET |
| `apps/web/app/api/movimentacoes/export/route.ts` | Criar — CSV/XLSX |
| `apps/web/app/api/movimentacoes/export/spca-espelho/route.ts` | Criar |
| `apps/web/app/api/movimentacoes/export/spca-zip/route.ts` | Criar |
| `apps/web/components/movimentacoes-table.tsx` | Reescrever |
| `apps/web/components/movimentacoes-export-menu.tsx` | Criar — submenu SPCA + modal prestador |
| `apps/web/components/movimentacoes-detail-drawer.tsx` | Criar — wrapper read-only OU prop em review-drawer |
| `apps/web/components/prestacao/review-drawer.tsx` | Modificar — prop `readOnly?: boolean` |
| `apps/web/app/movimentacoes/page.tsx` | Modificar — copy |
| `apps/web/lib/movimentacoes-filters.ts` | Criar — default UF/mês (localStorage) |

---

### Task 1: `parseMesFilter`

**Files:**
- Create: `packages/core/src/movimentacoes-aprovadas/parse-mes.ts`
- Test: `packages/core/src/movimentacoes-aprovadas/parse-mes.test.ts`

- [ ] **Step 1: Testes falhando**

```typescript
import { describe, expect, it } from "vitest";
import { parseMesFilter } from "./parse-mes";

describe("parseMesFilter", () => {
  it("parses 2025-01", () => {
    expect(parseMesFilter("2025-01")).toEqual({
      exercicio: 2025,
      from: "2025-01-01",
      to: "2025-01-31",
    });
  });

  it("rejects invalid", () => {
    expect(() => parseMesFilter("2025-13")).toThrow();
  });
});
```

- [ ] **Step 2: Implementar** — validar `YYYY-MM`, calcular último dia do mês (incl. fevereiro bissexto).

- [ ] **Step 3:** `pnpm --filter @spc-up/core test movimentacoes-aprovadas/parse-mes`

---

### Task 2: `listMovimentacoesAprovadas`

**Files:**
- Create: `packages/core/src/movimentacoes-aprovadas/types.ts`
- Create: `packages/core/src/movimentacoes-aprovadas/list.ts`
- Test: `packages/core/src/movimentacoes-aprovadas/list.test.ts`

- [ ] **Step 1: Tipos** — `MovimentacaoAprovadaItem`, `MovimentacoesAprovadasPayload` conforme spec §6.1.

- [ ] **Step 2: Query** com condições:
  - `status IN ('CONFIRMADO','EXPORTADO')`
  - `isNull(deletedAt)`, `isNull(movimentacaoCanonicaId)`
  - `uf`, `exercicio`, `dataMovimento` entre `from`/`to`
  - `orderBy`: `desc(dataMovimento)`, `asc(cnpjPrestador)`, `asc(id)`
  - `limit`/`offset` para paginação
  - `with`: `pessoaFisica`, `pessoaJuridica`, `arquivoIngestao`

- [ ] **Step 3: Resumo** — `COUNT` separado para CONFIRMADO vs EXPORTADO no mesmo filtro (subquery ou agregação).

- [ ] **Step 4: Prestadores distintos** — `SELECT DISTINCT cnpj_prestador` no recorte; resolver `prestador_nome` via join opcional em diretórios.

- [ ] **Step 5: Testes** com DB mock ou fixture in-memory (seguir padrão `planilha/list.test.ts`).

- [ ] **Step 6:** `pnpm --filter @spc-up/core test movimentacoes-aprovadas`

---

### Task 3: Exports lista (CSV + XLSX)

**Files:**
- Create: `packages/core/src/movimentacoes-aprovadas/export-list.ts`

- [ ] **Step 1: `listAllMovimentacoesAprovadas`** — mesma query sem paginação (cap interno ex.: 50_000; documentar).

- [ ] **Step 2: CSV** — UTF-8 BOM (`\uFEFF`), separador `,`, header na primeira linha, colunas spec §5.5.

- [ ] **Step 3: XLSX** — ExcelJS worksheet única “Movimentações”; mesmas colunas.

- [ ] **Step 4: Teste** — buffer não vazio; header contém `data_movimento`.

---

### Task 4: Espelho SPCA filtrado

**Files:**
- Create: `packages/core/src/movimentacoes-aprovadas/export-espelho.ts`
- Modify: `packages/core/src/export/excel-mirror.ts` (extrair função reutilizável se necessário)

- [ ] **Step 1: Refatorar** `buildExcelMirrorBuffer` → aceitar lista de `movimentacaoId[]` ou rows pré-carregadas.

- [ ] **Step 2: `buildEspelhoSpcaBufferForMovimentacoes`** — carregar `movimentacao` + `movimentacaoSpca` + pessoas para IDs do recorte UF+mês.

- [ ] **Step 3: Manter** lógica ENTRADA → Origem/Doação, SAIDA → Aplicação (copiar de `excel-mirror.ts`).

---

### Task 5: API GET `/api/movimentacoes`

**Files:**
- Modify: `apps/web/app/api/movimentacoes/route.ts`

- [ ] **Step 1:** Trocar params obrigatórios para `uf` + `mes` (remover `exercicio` obrigatório do client).

- [ ] **Step 2:** Delegar a `listMovimentacoesAprovadas`.

- [ ] **Step 3:** Remover `canExport` da response (não usado na nova UI).

- [ ] **Step 4:** Manter `DELETE` inalterado.

- [ ] **Step 5:** Verificar consumidores legados (`dashboard` legado, scripts) — atualizar ou documentar breaking change.

---

### Task 6: API exports

**Files:**
- Create: `apps/web/app/api/movimentacoes/export/route.ts`
- Create: `apps/web/app/api/movimentacoes/export/spca-espelho/route.ts`
- Create: `apps/web/app/api/movimentacoes/export/spca-zip/route.ts`

- [ ] **Step 1: `/export`** — `formato=csv|xlsx`; `Content-Disposition` com `movimentacoes_{uf}_{mes}.{ext}`.

- [ ] **Step 2: `/export/spca-espelho`** — XLSX; filename `espelho_{uf}_{mes}.xlsx`.

- [ ] **Step 3: `/export/spca-zip`** — params `uf`, `exercicio`, `cnpj_prestador`; chamar `exportPrestacaoZip`; tratar `ExportBlockedError` → 403, `XsdValidationError` → 422.

- [ ] **Step 4:** `runtime = "nodejs"` em todas (archiver/ExcelJS).

---

### Task 7: `review-drawer` read-only

**Files:**
- Modify: `apps/web/components/prestacao/review-drawer.tsx`

- [ ] **Step 1:** Prop `readOnly?: boolean` (default `false`).

- [ ] **Step 2:** Quando `readOnly`:
  - ocultar busca PF/PJ, botões confirmar/reprocessar
  - manter `OrigensPanel` e metadados
  - footer: `Link` “Abrir na planilha” se `sessaoId` truthy

- [ ] **Step 3:** `sessaoId` opcional quando `readOnly` (fetch detalhe não depende de sessão).

- [ ] **Step 4:** Garantir planilha/kanban existentes não quebram (`readOnly` omitido).

---

### Task 8: UI `movimentacoes-table`

**Files:**
- Rewrite: `apps/web/components/movimentacoes-table.tsx`
- Create: `apps/web/components/movimentacoes-export-menu.tsx`
- Create: `apps/web/lib/movimentacoes-filters.ts`
- Modify: `apps/web/app/movimentacoes/page.tsx`

- [ ] **Step 1: Filtros** — UF input + `<input type="month">`; persistir UF em `localStorage`; default mês = hoje.

- [ ] **Step 2: Fetch** — `GET /api/movimentacoes?uf=&mes=&page=`; estado `page`, `totalPages`.

- [ ] **Step 3: Tabela** — colunas spec §5.2; clique abre `ReviewDrawer` com `readOnly`.

- [ ] **Step 4: Paginação** — botões prev/next desabilitados nos limites.

- [ ] **Step 5: Toolbar** — botões CSV, XLSX, dropdown SPCA.

- [ ] **Step 6: `movimentacoes-export-menu`** — submenu; ZIP abre modal se `prestadores.length > 1`; aviso texto spec §5.5.

- [ ] **Step 7: Remover** botão Confirmar e badge exportável legado.

- [ ] **Step 8: Empty state** — “Nenhuma movimentação aprovada neste período.”

---

### Task 9: Exports core + index

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] Exportar funções públicas do módulo `movimentacoes-aprovadas`.

---

### Task 10: Verificação final

- [ ] `pnpm --filter @spc-up/core test`
- [ ] `pnpm --filter @spc-up/web build`
- [ ] Manual: `/movimentacoes` com UF+mês que tenha CONFIRMADO → tabela + drawer + CSV
- [ ] Manual: redirect `/prestacao/:id/movimentacoes` → planilha (regressão)
- [ ] Checklist spec §9 (10 cenários)

---

## Breaking changes

| Antes | Depois |
|-------|--------|
| `GET /api/movimentacoes?uf=&exercicio=` | `GET /api/movimentacoes?uf=&mes=YYYY-MM&page=` |
| Retorna todos status | Só CONFIRMADO + EXPORTADO |
| Response inclui `exportavel` | Removido |
| UI com Confirmar | Removido |

**Migrar consumidores:** grep `api/movimentacoes` no monorepo antes do merge.

---

## Ordem sugerida

1. Task 1–4 (core)
2. Task 5–6 (API)
3. Task 7 (drawer)
4. Task 8 (UI)
5. Task 9–10 (exports + verificação)
