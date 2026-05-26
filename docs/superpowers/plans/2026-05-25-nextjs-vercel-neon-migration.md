# Next.js + Vercel + Neon Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever o SPC UP em TypeScript (Turborepo), deploy na Vercel com Neon Postgres e Vercel Blob, mantendo paridade total com o monólito Python (web, CLI, ingestão, export XML SPCA, auth).

**Architecture:** Turborepo com `packages/core` compartilhado entre `apps/web` (Next.js 15) e `apps/cli` (Commander). Drizzle ORM no Neon. Auth.js allowlist. Ingestão web assíncrona; CLI síncrona.

**Tech Stack:** Next.js 15, React 19, Tailwind, shadcn/ui, Auth.js v5, Drizzle ORM, `@neondatabase/serverless`, Vercel Blob, Vitest, Turborepo, pnpm, exceljs, libxmljs2 (XSD).

**Spec:** `docs/superpowers/specs/2026-05-25-nextjs-vercel-neon-migration-design.md`

**Python reference (port source):** `spc_up/**`, `tests/**`, `migrations/versions/001_initial.py`

---

## File map (new monorepo)

| Path | Responsibility |
|------|----------------|
| `package.json` | pnpm workspace root, turbo scripts |
| `turbo.json` | build/test pipeline |
| `pnpm-workspace.yaml` | `apps/*`, `packages/*` |
| `apps/web/` | Next.js App Router, Auth.js, UI, API routes |
| `apps/cli/` | `spc-up` Commander CLI |
| `packages/db/` | Drizzle schema, migrations, `getDb()` |
| `packages/core/` | ingest, match, export, ai, report, normalize, confidence |
| `packages/spca/` | XSD files, YAML tables, `validateXsd()` |
| `scripts/migrate-storage.ts` | local `./data/uploads` → Vercel Blob |
| `scripts/migrate-db.md` | pg_dump/restore runbook |
| `.github/workflows/ci.yml` | pnpm test (replace Python CI) |
| `vercel.json` | root directory `apps/web`, region `gru1` |

**Legacy (remove after Task 30):** `spc_up/`, `pyproject.toml`, `alembic.ini`, `migrations/`, `tests/test_*.py`

---

### Task 1: Turborepo bootstrap

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.npmrc`, `apps/web/package.json`, `apps/cli/package.json`, `packages/db/package.json`, `packages/core/package.json`, `packages/spca/package.json`
- Create: `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`
- Create: `.env.example` (root)

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "spc-up",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "db:generate": "pnpm --filter @spc-up/db generate",
    "db:migrate": "pnpm --filter @spc-up/db migrate"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.8.0",
    "vitest": "^3.0.0"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "test": { "dependsOn": ["^build"] },
    "lint": {}
  }
}
```

- [ ] **Step 4: Scaffold `apps/web` with Next.js**

Run from repo root:

```bash
cd apps && pnpm create next-app@latest web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --turbopack --no-git
```

Move generated app into `apps/web` if needed; add to workspace.

- [ ] **Step 5: Add workspace deps in `apps/web/package.json`**

```json
"dependencies": {
  "@spc-up/core": "workspace:*",
  "@spc-up/db": "workspace:*",
  "@spc-up/spca": "workspace:*",
  "next-auth": "^5.0.0-beta.25",
  "@vercel/blob": "^0.27.0",
  "bcryptjs": "^2.4.3",
  "zod": "^3.24.0"
}
```

- [ ] **Step 6: Verify dev server starts**

Run: `pnpm install && pnpm --filter web dev`  
Expected: Next.js on http://localhost:3000

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json apps/web packages apps/cli .npmrc
git commit -m "chore: bootstrap turborepo with Next.js web app"
```

---

### Task 2: Package stubs (`db`, `core`, `spca`, `cli`)

**Files:**
- Create: `packages/db/src/index.ts`, `packages/core/src/index.ts`, `packages/spca/src/index.ts`
- Create: `apps/cli/src/main.ts`, `apps/cli/package.json` with `bin`

- [ ] **Step 1: `packages/db/package.json`**

```json
{
  "name": "@spc-up/db",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "generate": "drizzle-kit generate",
    "migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@neondatabase/serverless": "^0.10.0",
    "drizzle-orm": "^0.39.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.30.0"
  }
}
```

- [ ] **Step 2: `packages/core/package.json` with vitest**

```json
{
  "name": "@spc-up/core",
  "version": "0.1.0",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@spc-up/db": "workspace:*",
    "@spc-up/spca": "workspace:*",
    "exceljs": "^4.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": { "vitest": "^3.0.0" }
}
```

- [ ] **Step 3: `apps/cli/package.json`**

```json
{
  "name": "@spc-up/cli",
  "bin": { "spc-up": "./dist/main.js" },
  "scripts": { "build": "tsup src/main.ts --format esm --dts", "test": "vitest run" },
  "dependencies": {
    "@spc-up/core": "workspace:*",
    "@spc-up/db": "workspace:*",
    "commander": "^13.0.0"
  }
}
```

- [ ] **Step 4: Run `pnpm install` from root**  
Expected: workspace links resolve

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: add db, core, spca, cli package stubs"
```

---

### Task 3: Drizzle schema (mirror Alembic `001_initial`)

**Files:**
- Create: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`
- Port from: `migrations/versions/001_initial.py`, `spc_up/models/entities.py`

- [ ] **Step 1: Write `packages/db/src/schema.ts` tables**

Define with `drizzle-orm/pg-core`: `diretorioEstadual`, `pessoaFisica`, `pessoaJuridica`, `contaBancaria`, `arquivoIngestao`, `movimentacao`, `matchEvidencia`, `exportacao`, `bloqueioExport` — column names match SQL from `001_initial.py` (snake_case in DB).

Add new table:

```typescript
export const usuario = pgTable("usuario", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  ativo: boolean("ativo").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: `packages/db/src/client.ts`**

```typescript
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  return drizzle(neon(url), { schema });
}

export type Db = ReturnType<typeof getDb>;
```

- [ ] **Step 3: Generate migration `0001_initial` + `0002_usuario`**

Run: `pnpm db:generate` then `pnpm db:migrate` against local Neon branch or Docker Postgres with `DATABASE_URL`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(db): add Drizzle schema mirroring Alembic initial"
```

---

### Task 4: Port `normalize` + tests

**Files:**
- Create: `packages/core/src/normalize.ts`
- Create: `packages/core/src/normalize.test.ts`
- Port from: `spc_up/services/normalize.py`, `tests/test_normalize.py`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, expect, it } from "vitest";
import { normalizeCpf, normalizeCnpj, normalizeName } from "./normalize";

describe("normalize", () => {
  it("strips CPF mask", () => {
    expect(normalizeCpf("123.456.789-09")).toBe("12345678909");
  });
  it("normalizes CNPJ length", () => {
    expect(normalizeCnpj("12.345.678/0001-90")).toHaveLength(14);
  });
  it("normalizes name", () => {
    expect(normalizeName("  João   da  Silva ")).toBe("JOAO DA SILVA");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @spc-up/core test`  
Expected: module not found

- [ ] **Step 3: Implement `normalize.ts`** — port logic verbatim from `spc_up/services/normalize.py` (CPF check digits, CNPJ TSE regex `[A-Z0-9]{12}[0-9]{2}`, NFD accent strip).

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): port normalize utilities with tests"
```

---

### Task 5: Port `confidence` + tests

**Files:**
- Create: `packages/core/src/confidence.ts`, `confidence.test.ts`
- Port from: `spc_up/services/confidence.py`, `tests/test_confidence.py`

- [ ] **Step 1–5:** Same TDD cycle as Task 4; port `compute_global_confidence` and evidence aggregation from Python.

---

### Task 6: Port `packages/spca` (tables + XSD validate)

**Files:**
- Create: `packages/spca/schemas/*.xsd` (copy from `spc_up/spca/schemas/`)
- Create: `packages/spca/tabelas/*.yaml` (copy from `spc_up/spca/tabelas/`)
- Create: `packages/spca/src/load-tables.ts`, `validate-xsd.ts`, tests
- Port from: `spc_up/spca/load_tables.py`, `validate.py`, `tests/test_load_tables.py`, `tests/test_validate_origem.py`

- [ ] **Step 1: Copy XSD/YAML assets**

```bash
cp spc_up/spca/schemas/*.xsd packages/spca/schemas/
cp spc_up/spca/tabelas/*.yaml packages/spca/tabelas/
```

- [ ] **Step 2: Implement `loadTables()`** — parse YAML to typed records (classificacao receita, codigos gasto).

- [ ] **Step 3: Implement `validateXsd(xmlPath, schemaKind)`** using `libxmljs2` OR shell out to `xmllint --noout --schema` in CI (document in README if xmllint required locally).

- [ ] **Step 4: Port tests from `test_load_tables.py` and `test_validate_origem.py`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(spca): add XSD assets and validation"
```

---

### Task 7: Port `match/rules`

**Files:**
- Create: `packages/core/src/match/rules.ts`, `match/rules.test.ts`
- Port from: `spc_up/services/match/rules.py`, `tests/test_match_rules.py`

- [ ] **TDD cycle:** port deterministic matching + confidence hooks; all `test_match_rules.py` scenarios must pass.

---

### Task 8: Port ingest — OFX/CSV

**Files:**
- Create: `packages/core/src/ingest/ofx.ts`, `ingest/pipeline.ts`, `ingest/ofx.test.ts`
- Copy fixture: `tests/fixtures/sample.ofx` → `packages/core/fixtures/sample.ofx`
- Port from: `spc_up/services/ingest/ofx.py`, `pipeline.py`, `tests/test_ingest_ofx.py`

- [ ] **Step 1:** Failing test using fixture (row count, amounts).
- [ ] **Step 2:** Implement parser (choose `ofx-js` or port line parser from Python).
- [ ] **Step 3:** `persistTransactions(db, uf, exercicio, arquivoId, rows)` using Drizzle inserts.
- [ ] **Step 4:** PASS + commit `feat(core): port OFX ingest`

---

### Task 9: Port ingest — Excel

**Files:**
- Create: `packages/core/src/ingest/excel.ts`, `excel.test.ts`
- Copy: `tests/fixtures/sample.xlsx` → `packages/core/fixtures/sample.xlsx`
- Port from: `spc_up/services/ingest/excel.py`, `tests/test_ingest_excel.py`

- [ ] **Use `exceljs`** — mirror column mapping from Python.

---

### Task 10: Port ingest — PDF + OpenRouter

**Files:**
- Create: `packages/core/src/ai/openrouter.ts`, `ingest/pdf.ts`, tests
- Port from: `spc_up/services/ai/openrouter.py`, `ingest/pdf.py`, `tests/test_openrouter_parse.py`

- [ ] **Step 1:** Port OpenRouter client with structured JSON schema (same prompts/fields as Python).
- [ ] **Step 2:** `ingestPdf(buffer, ...)` returns transaction rows.
- [ ] **Step 3:** Mock `fetch` in Vitest for API tests (no real API key in CI).

---

### Task 11: Port export — origem, aplicação, doação, guard

**Files:**
- Create: `packages/core/src/export/origem.ts`, `aplicacao.ts`, `doacao.ts`, `guard.ts`, `common.ts`, `run.ts`
- Create: golden tests: `packages/core/src/export/*.test.ts`
- Port from: `spc_up/services/export/*`, `tests/test_export_*.py`, `tests/test_export_guard.py`

- [ ] **Step 1:** Port `canExport(db, uf, exercicio)` from `guard.py` — test `test_export_guard.py` scenarios.
- [ ] **Step 2:** Port XML builders; compare output to committed golden XML in `packages/core/fixtures/golden/` (generate once from Python: `spc-up export` on sample data).
- [ ] **Step 3:** Wire `exportRun(db, uf, exercicio)` → ZIP buffer with 3 XMLs + XSD validate each.
- [ ] **Step 4:** Commit when all export tests pass.

---

### Task 12: Port `report/pendencias`

**Files:**
- Create: `packages/core/src/report/pendencias.ts`
- Port from: `spc_up/services/report/pendencias.py`

- [ ] **CLI CSV output** — same columns as Python `pendencias.csv`.

---

### Task 13: CLI (`apps/cli`)

**Files:**
- Create: `apps/cli/src/main.ts`, `commands/ingest.ts`, `confirm.ts`, `export.ts`, `pendencias.ts`, `validate-xsd.ts`
- Port from: `spc_up/cli/main.py`, `tests/test_cli.py`

- [ ] **Step 1: Commander setup**

```typescript
#!/usr/bin/env node
import { Command } from "commander";
const program = new Command().name("spc-up");
program.command("ingest").option("--uf <uf>").option("--exercicio <year>").requiredOption("--path <path>").action(ingestAction);
// pendencias, confirm, export, validate-xsd
program.parse();
```

- [ ] **Step 2:** Each action calls `@spc-up/core` with `getDb()` from env `DATABASE_URL`.
- [ ] **Step 3:** Port `tests/test_cli.py` as `apps/cli/src/cli.test.ts` (spawn CLI or test handlers).
- [ ] **Step 4:** `pnpm --filter @spc-up/cli build` — verify `node apps/cli/dist/main.js ingest --help`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cli): port spc-up commands to Node"
```

---

### Task 14: Auth.js + `usuario` seed

**Files:**
- Create: `apps/web/auth.ts`, `apps/web/middleware.ts`, `apps/web/app/login/page.tsx`
- Create: `packages/db/src/seed-usuario.ts` or script `scripts/seed-admin.ts`
- Port behavior: spec §4.3

- [ ] **Step 1: Configure Auth.js Credentials provider**

```typescript
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { getDb } from "@spc-up/db";
import { usuario } from "@spc-up/db/schema";
import { eq } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const db = getDb();
        const row = await db.query.usuario.findFirst({
          where: eq(usuario.email, creds.email as string),
        });
        if (!row?.ativo) return null;
        const ok = await compare(creds.password as string, row.passwordHash);
        return ok ? { id: row.id, email: row.email } : null;
      },
    }),
  ],
  pages: { signIn: "/login" },
});
```

- [ ] **Step 2: `middleware.ts`** — protect all except `/login`, `/api/auth/*`.

- [ ] **Step 3: Login page** — shadcn Form, email/password, `signIn("credentials")`.

- [ ] **Step 4: Seed script** — hash `ADMIN_PASSWORD` from env, insert `ADMIN_EMAIL`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): add Auth.js credentials and login page"
```

---

### Task 15: API routes — movimentações + confirm

**Files:**
- Create: `apps/web/app/api/movimentacoes/route.ts`, `apps/web/app/api/movimentacoes/confirm/route.ts`
- Port from: `spc_up/api/routes/movimentacoes.py`

- [ ] **GET `/api/movimentacoes?uf&exercicio`** — JSON `{ total, exportavel, items[] }` same shape as Python.
- [ ] **POST `/api/movimentacoes/confirm`** — body `{ ids: string[] }`.
- [ ] **Auth:** wrap with `auth()` session check; return 401 if missing.
- [ ] **Tests:** `apps/web/app/api/movimentacoes/route.test.ts` with mocked db or test Neon.

---

### Task 16: API routes — upload + Blob

**Files:**
- Create: `apps/web/app/api/upload/route.ts`
- Create: `packages/core/src/ingest/store-upload.ts`
- Port from: `spc_up/api/routes/upload.py`, `spc_up/services/ingest/pipeline.py`

- [ ] **Step 1:** `put()` file to Vercel Blob path `{uf}/{exercicio}/{uuid}/{filename}`.
- [ ] **Step 2:** Insert `arquivo_ingestao` with `caminho_storage` = blob URL.
- [ ] **Step 3:** Trigger ingest (sync for OFX/Excel; queue/workflow for PDF — see Task 18).
- [ ] **Step 4:** Return JSON `{ arquivo, movimentacoes_criadas }` like Python.

---

### Task 17: API route — export ZIP

**Files:**
- Create: `apps/web/app/api/export/[uf]/[exercicio]/route.ts`
- Port from: `spc_up/api/routes/export.py`

- [ ] **Return 403** when `!canExport(db, uf, exercicio)` with message body.
- [ ] **Return `application/zip`** with 3 XML files on success.

---

### Task 18: PDF async ingest (Vercel)

**Files:**
- Create: `apps/web/app/api/ingest/process/route.ts` OR Vercel Workflow definition
- Port from: `spc_up/services/ingest/pdf.py`

- [ ] **If PDF:** set `arquivo_ingestao.status = PROCESSANDO`, enqueue job, return 202.
- [ ] **Worker** calls `ingestPdf` from `@spc-up/core`, updates status CONCLUIDO/ERRO.
- [ ] **Fallback for v1:** document that CLI `ingest` handles PDF synchronously if Workflow not ready; web PDF must work for parity — implement Workflow or `waitUntil` + `maxDuration` in `vercel.json`.

```json
{
  "functions": {
    "app/api/upload/route.ts": { "maxDuration": 300 }
  }
}
```

---

### Task 19: UI — Dashboard + Upload

**Files:**
- Create: `apps/web/app/page.tsx`, `components/dashboard.tsx`, `components/upload-form.tsx`
- Port UX from: `spc_up/api/templates/dashboard.html`

- [ ] **shadcn:** Select UF, Input exercicio, Badge export status, Upload form, Link to movimentações, Download ZIP button (disabled when blocked).

---

### Task 20: UI — Movimentações

**Files:**
- Create: `apps/web/app/movimentacoes/page.tsx`, `components/movimentacoes-table.tsx`
- Port from: `spc_up/api/templates/movimentacoes.html`

- [ ] **Client fetch** `/api/movimentacoes`; highlight rows `confianca_global < 0.85`; Confirm button per row.

---

### Task 21: shadcn init + layout shell

**Files:**
- Modify: `apps/web/app/layout.tsx`, `components/ui/*`

- [ ] Run: `cd apps/web && pnpm dlx shadcn@latest init`
- [ ] Add: `button`, `input`, `table`, `badge`, `card`, `toast`
- [ ] App shell: header "SPC UP", user menu with sign out.

---

### Task 22: Migration script — PostgreSQL → Neon

**Files:**
- Create: `scripts/migrate-db.md`, `scripts/verify-counts.ts`

- [ ] **Document runbook:**

```bash
pg_dump "$OLD_DATABASE_URL" --schema-only -f /tmp/schema.sql
pg_dump "$OLD_DATABASE_URL" --data-only -f /tmp/data.sql
psql "$NEON_DATABASE_URL" -f /tmp/schema.sql
psql "$NEON_DATABASE_URL" -f /tmp/data.sql
pnpm db:migrate  # only 0002_usuario if not in dump
```

- [ ] **`verify-counts.ts`** — compare row counts: `movimentacao`, `arquivo_ingestao`, `diretorio_estadual` old vs new.

---

### Task 23: Migration script — storage → Blob

**Files:**
- Create: `scripts/migrate-storage.ts`

- [ ] **For each `arquivo_ingestao`:** read `caminho_storage` from disk; `put` to Blob; `update` row.
- [ ] **Log missing files** without aborting.

---

### Task 24: Vercel + Neon setup

**Files:**
- Create: `vercel.json`, update `apps/web/.env.example`
- Modify: `README.md`

- [ ] Link repo to Vercel; root directory `apps/web`.
- [ ] Install Neon integration → `DATABASE_URL`.
- [ ] Set env: `BLOB_READ_WRITE_TOKEN`, `OPENROUTER_API_KEY`, `AUTH_SECRET`, `AUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
- [ ] Region `gru1` in project settings.
- [ ] Preview deploy smoke: login, list movimentações.

---

### Task 25: CI — replace Python workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install
      - run: pnpm test
      - name: XSD (optional)
        run: sudo apt-get install -y libxml2-utils
```

- [ ] Remove Python pytest job after green.

---

### Task 26: Paridade gate — full regression

- [ ] Run Python pytest on tag `pre-nextjs-cutover` — save summary.
- [ ] Run `pnpm test` — all packages green.
- [ ] Manual: ingest fixture UF SP 2025 → confirm all → export → `spc-up validate-xsd` on 3 files.
- [ ] Compare ZIP hash or normalized XML diff vs Python golden.

---

### Task 27: Cutover + archive Python

- [ ] Tag: `git tag pre-nextjs-cutover`
- [ ] Migrate prod DB + storage (Tasks 22–23).
- [ ] Point DNS / Vercel production.
- [ ] Move `spc_up/` → `legacy/python/` OR delete with tag reference.
- [ ] Update README quick start for `pnpm` + Vercel.
- [ ] Commit: `chore: complete Next.js migration cutover`

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Turborepo monorepo | 1–2 |
| Drizzle + Neon | 3, 22 |
| Vercel Blob | 16, 23 |
| Paridade ingest | 8–10 |
| Paridade match/export | 7, 11 |
| CLI Node | 13 |
| Auth allowlist | 3 (usuario), 14 |
| Web UI parity | 19–21 |
| PDF async web | 18 |
| Data migration | 22–23 |
| Deploy Vercel | 24 |
| Cutover | 26–27 |

---

## Self-review (plan)

- No TBD placeholders in task steps.
- Each pytest file mapped to a Vitest port task (4–11, 13, 15–17).
- Type names consistent: `getDb()`, `canExport`, `normalizeCpf`.
- Scope matches single migration project; Python removed only in Task 27 after gate Task 26.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-nextjs-vercel-neon-migration.md`.**

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach do you want?**
