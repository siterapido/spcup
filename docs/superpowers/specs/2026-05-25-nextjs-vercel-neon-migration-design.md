# SPC UP — Migração Next.js + Vercel + Neon (Design)

**Data:** 2026-05-25  
**Status:** Aprovado em brainstorming (seções 1–4)  
**Substitui (runtime):** `docs/superpowers/specs/2026-05-25-spc-up-prestacao-contas-design.md` §4.1 infra on-prem — regras de negócio SPCA permanecem válidas.

---

## 1. Resumo executivo

Reescrever o **SPC UP** inteiro em **TypeScript**: monorepo **Turborepo** com **Next.js 15** (web + API), **CLI Node**, **Neon Postgres**, **Vercel Blob** e deploy na **Vercel**. Eliminar Python/FastAPI/Typer/Alembic após cutover com **paridade funcional total** em relação ao sistema atual.

**Decisões de produto (registro brainstorming)**

| Tema | Decisão |
|------|---------|
| Stack | Full stack TypeScript (sem Python) |
| CLI | Web + CLI Node na v1 (`ingest`, `pendencias`, `confirm`, `export`, `validate-xsd`) |
| Auth | Login simples (e-mail/senha), allowlist em tabela `usuario` |
| Escopo v1 | Paridade total antes do cutover |
| Banco | Migrar PostgreSQL existente → Neon (schema + dados) |
| Arquivos | Vercel Blob; migrar `./data/uploads` legado |
| Arquitetura repo | Turborepo: `apps/web`, `apps/cli`, `packages/core`, `packages/db`, `packages/spca` |

**Regras de negócio inalteradas:** ver spec original SPCA (export bloqueado com pendências, 3 XMLs por UF/exercício, crédito→Origem, débito→Aplicação, OpenRouter para PDF, etc.).

---

## 2. Abordagem escolhida

### Opções consideradas

1. **Turborepo monorepo** (escolhida) — web e CLI compartilham `packages/core`.
2. Repositório único Next.js — menos boilerplate, acoplamento CLI/web.
3. Next.js + fila externa dedicada — adiada; workflow Vercel só onde a web precisar.

### Estrutura do repositório

```text
apps/
  web/          Next.js 15 App Router, Auth.js, UI shadcn
  cli/          spc-up CLI (Commander), importa packages/core
packages/
  core/         ingest, match, export, ai, report
  db/           Drizzle schema, migrations, client Neon
  spca/         XSD, YAML tabelas, validação XML
scripts/
  migrate-storage.ts   arquivos locais → Vercel Blob
  migrate-db.sh          pg_dump/restore documentado
```

**Deploy:** apenas `apps/web` na Vercel. CLI executa local/CI com `DATABASE_URL` apontando para Neon.

---

## 3. Arquitetura

### 3.1 Runtime

| Componente | Tecnologia |
|------------|------------|
| Web/API | Next.js 15 App Router, Route Handlers / Server Actions |
| ORM | Drizzle + `@neondatabase/serverless` |
| DB | Neon Postgres (integração Vercel Marketplace) |
| Storage | `@vercel/blob` |
| Auth | Auth.js v5, Credentials, middleware |
| IA PDF | OpenRouter (mesmo contrato do Python) |
| UI | Tailwind + shadcn/ui |

### 3.2 Mapeamento Python → TypeScript

| Módulo Python | Pacote TS |
|---------------|-----------|
| `spc_up/services/ingest/*` | `packages/core/ingest` |
| `spc_up/services/match/*` | `packages/core/match` |
| `spc_up/services/export/*` | `packages/core/export` |
| `spc_up/services/ai/*` | `packages/core/ai` |
| `spc_up/services/report/*` | `packages/core/report` |
| `spc_up/spca/*` | `packages/spca` |
| `spc_up/models/*` | `packages/db/schema` |
| `spc_up/api/*` | `apps/web` rotas |
| `spc_up/cli/*` | `apps/cli` |

### 3.3 Jobs assíncronos (web)

- Upload: gravar Blob → enfileirar ingestão.
- PDF + OpenRouter: usar **Vercel Workflow** ou `waitUntil` com timeout estendido quando > ~30s.
- **CLI:** processamento **síncrono** no terminal (sem limite serverless), mesma lib `packages/core`.

### 3.4 Variáveis de ambiente

| Variável | Uso |
|----------|-----|
| `DATABASE_URL` | Neon pooled (runtime) |
| `DATABASE_URL_UNPOOLED` | Migrations Drizzle |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
| `OPENROUTER_API_KEY` | Ingestão PDF |
| `AUTH_SECRET` | Auth.js |
| `AUTH_URL` | URL canônica (prod/preview) |

### 3.5 Região e integrações Vercel

- Região preferencial: `gru1` (latência Brasil), se suportada no plano.
- Neon + Blob provisionados via dashboard/CLI Vercel.

---

## 4. UI/UX e autenticação

### 4.1 Rotas

| Rota | Função |
|------|--------|
| `/login` | E-mail + senha |
| `/` | Dashboard UF/exercício, status export, links |
| `/movimentacoes` | Revisão e confirmação |
| Upload | Form no dashboard ou `/upload` |
| `GET /api/export/[uf]/[exercicio]` | ZIP 3 XMLs (403 se guard bloquear) |

### 4.2 Paridade de fluxos

- Dashboard: badge export liberada/bloqueada; download ZIP condicional.
- Upload: OFX, Excel, PDF; status `arquivo_ingestao` com feedback de processamento.
- Movimentações: tabela com score, destaque score < 0,85, confirmar por linha.
- Toasts e loading states (melhoria UX sem mudar regras).

### 4.3 Auth

- Tabela `usuario`: `id`, `email` (unique), `password_hash` (bcrypt), `ativo`, timestamps.
- Seed: script ou env `ADMIN_EMAIL` / `ADMIN_PASSWORD` no primeiro deploy.
- Middleware protege todas as rotas exceto `/login`.
- CLI: conexão direta Neon via `DATABASE_URL` (equipe de confiança); sem cookie de sessão.

### 4.4 Fora de escopo UI v1

- Acesso por UF/estado.
- Branding elaborado, PWA.

---

## 5. Dados e migração

### 5.1 Schema

- Drizzle espelha migrations Alembic existentes.
- **Única tabela nova obrigatória:** `usuario`.
- Preservar UUIDs e tipos PostgreSQL (`NUMERIC`, `ARRAY`, etc.).

### 5.2 Migração banco

1. `pg_dump --schema-only` e `--data-only` do Postgres atual.
2. Restore no Neon.
3. Migration Drizzle para `usuario` (+ índices auth).
4. Script de validação: contagens por tabela vs origem.

### 5.3 Migração arquivos

- Script `scripts/migrate-storage.ts`: para cada `arquivo_ingestao`, ler `caminho_storage` local, `put` no Blob, atualizar campo.
- Pattern Blob: `{uf}/{exercicio}/{arquivo_id}/{nome_arquivo}`.
- Arquivo ausente: log; não bloquear se ingestão já concluída.

### 5.4 Bibliotecas de ingestão (TS)

| Formato | Biblioteca alvo |
|---------|-----------------|
| Excel | `exceljs` |
| OFX | parser OFX equivalente (ex. `ofx-js` ou port testado) |
| PDF | OpenRouter via `packages/core/ai` |
| XML/XSD | `libxmljs2` e/ou `xmllint` em CI |

---

## 6. CLI Node

Comandos equivalentes ao Typer atual:

```bash
pnpm spc-up ingest --uf SP --exercicio 2025 --path ./dados/
pnpm spc-up pendencias --uf SP --exercicio 2025 --output pendencias.csv
pnpm spc-up confirm --ids "uuid1,uuid2"
pnpm spc-up export --uf SP --exercicio 2025 --out ./export/
pnpm spc-up validate-xsd --file ./export/origem_*.xml --schema origem
```

Implementação: `apps/cli` → importa funções de `packages/core` (mesmas usadas pela web).

---

## 7. Testes, CI e cutover

### 7.1 Testes

- **Vitest** em `packages/core`, `packages/spca`, `apps/cli`, smoke `apps/web`.
- Fixtures migradas de `tests/fixtures/`.
- Golden files XML para regressão vs Python (primeira migração gera baseline).

### 7.2 CI

- GitHub Actions: `pnpm install` → `pnpm test` → (opcional) validação XSD em artefato.
- Remover workflow Python após cutover.

### 7.3 Gate de cutover

1. Suite Vitest verde com paridade de cenários pytest.
2. Staging Vercel + Neon com dump migrado.
3. Checklist piloto (`docs/piloto-checklist.md`) em preview.
4. Promote produção; desligar stack Python.
5. Tag git `legacy-python` no commit pré-migração.

### 7.4 Rollback

- Branch/backup Neon pré-cutover.
- Tag `pre-nextjs-cutover` para reativar Python temporariamente se necessário (evitar writes concorrentes).

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Timeout ingestão PDF na web | Vercel Workflow; CLI síncrono |
| Validação XSD em Node | `libxmljs2` + `xmllint` no CI |
| Divergência XML Python/TS | Golden file tests |
| Arquivos locais perdidos | migrate-storage + logs |
| PII em staging | Dump mascarado ou subset de UFs |

---

## 9. O que é removido após cutover

- `spc_up/` Python, `pyproject.toml`, Alembic, `docker-compose.yml` (opcional manter só para migração temporária).
- FastAPI, Jinja templates, Typer.
- CI pytest (substituído por Vitest).

---

## 10. Critérios de sucesso

- Todos os testes de regressão (Vitest) equivalentes aos pytest atuais passam.
- Migração Neon + Blob concluída sem perda de PKs.
- Equipe nacional opera piloto 2–3 UFs na Vercel com auth.
- 3 XMLs passam validação XSD e importação manual SPCA (homologação).
- CLI Node executa os cinco comandos contra Neon produção.

---

## 11. Próximo passo

Após revisão deste spec: criar plano de implementação via skill **writing-plans** (`docs/superpowers/plans/2026-05-25-nextjs-vercel-neon-migration.md`).
