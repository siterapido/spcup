# Plataforma operacional — Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard técnico com agregados, cadastro PF/PJ polish (máscaras, titulo_eleitor, UF/exercício, retorno), badge conflitos e empty states.

**Architecture:** `packages/core/src/report/system-stats.ts` + stats no server `page.tsx`; estender form/API pessoas; polish nav.

**Tech Stack:** TypeScript, Drizzle, Next.js, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-26-plataforma-operacional-fase2-design.md](../specs/2026-05-26-plataforma-operacional-fase2-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/report/system-stats.ts` | `getSystemStats` |
| `packages/core/src/report/system-stats.test.ts` | Tests |
| `apps/web/components/dashboard/system-stats-panel.tsx` | Tabelas métricas |
| `apps/web/app/page.tsx` | Painel + filtro |
| `apps/web/lib/validate-document.ts` | Validação client |
| `apps/web/lib/format-document.ts` | Máscaras input |
| `apps/web/components/pessoa-form.tsx` | Form completo |
| `apps/web/app/api/pessoas/route.ts` | tituloEleitor, uf, exercicio |
| `apps/web/app/api/pessoas/conflitos/count/route.ts` | Badge count |
| `apps/web/components/app-nav.tsx` | Badge |

---

### Task 1: system-stats core (TDD)

Create `getSystemStats(db, { uf, exercicio })` with global + scoped aggregates per spec §3. Export from index. Tests + commit.

### Task 2: Dashboard UI

Server-side `getSystemStats` in `page.tsx`, component `SystemStatsPanel`, filter form, keep CTAs + legado details. Commit.

### Task 3: Document mask/validate libs

`format-document.ts`, `validate-document.ts`. Commit.

### Task 4: PessoaForm + API

Masks, titulo_eleitor, uf/exercicio, retorno URL; extend POST API and core upsert if needed. Commit.

### Task 5: Import/conflitos/nav

count API, nav badge, import error table, empty-state component. Commit.

### Task 6: Perfil + polish

titulo in perfil API/UI; dashboard link estaduais. Commit.

### Task 7: Verify

core test + web tsc. Commit.
