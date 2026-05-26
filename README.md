# SPC UP — Prestação de Contas

Consolidação de lançamentos financeiros dos diretórios estaduais da UP e exportação XML para importação no **SPCA** (Origem, Aplicação, Doação financeira).

## Quick start

```bash
git clone https://github.com/unidade-popular/spc-up.git
cd spc-up
pnpm install
cp .env.example .env
# DATABASE_URL (Neon ou Docker), BLOB_READ_WRITE_TOKEN, AUTH_*, OPENROUTER_API_KEY, ADMIN_*
pnpm db:migrate
pnpm seed:diretorios
pnpm seed:admin
pnpm test
pnpm dev
```

Ambiente automatizado (Postgres Docker opcional): `./scripts/run-local.sh`

Deploy produção: **[docs/deploy-vercel-neon.md](docs/deploy-vercel-neon.md)**

## CLI

```bash
pnpm --filter @spc-up/cli build
pnpm spc-up ingest --uf SP --exercicio 2025 --path ./dados/
pnpm spc-up pendencias --uf SP --exercicio 2025 --output pendencias.csv
pnpm spc-up confirm --ids "uuid1,uuid2"
pnpm spc-up export --uf SP --exercicio 2025 --out ./export/
pnpm spc-up validate-xsd --file ./export/origem_SP.xml --schema origem
```

Ingest CLI: `DATABASE_URL` + `STORAGE_ROOT` (default `./data/uploads`).

## Fluxo operacional

```text
Estados enviam arquivos → Equipe nacional ingere → Revisa pendências → Confirma → Exporta 3 XMLs → Upload manual no SPCA
```

## Regras de exportação

- Export **bloqueado** enquanto existir movimentação não confirmada ou `bloqueio_export=true` na UF/exercício.
- XMLs **inválidos contra XSD** não são publicados (API 422; CLI exit 1).
- Cada UF usa seu **CNPJ** (`diretorio_estadual.cnpj_prestador`) nos XMLs.
- **Crédito** → Origem (+ Doação se classificação de doação PF). **Débito** → Aplicação.

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| [docs/deploy-vercel-neon.md](docs/deploy-vercel-neon.md) | Vercel, Neon, Blob, seeds, `gru1`, `AUTH_URL` |
| [docs/piloto-checklist.md](docs/piloto-checklist.md) | Piloto 1 semana (TypeScript) |
| [docs/superpowers/specs/2026-05-26-cadastro-pf-pj-design.md](docs/superpowers/specs/2026-05-26-cadastro-pf-pj-design.md) | Cadastro PF/PJ, importação e perfil |
| [docs/spca-fontes.md](docs/spca-fontes.md) | Fontes SPCA / XSD |
| `docs/superpowers/specs/2026-05-25-spc-up-prestacao-contas-design.md` | Regras de negócio |
| `docs/superpowers/specs/2026-05-25-nextjs-vercel-neon-migration-design.md` | Design migração |
| `scripts/migrate-db.md` | pg_dump / restore → Neon |

## Stack

**Produção:** Next.js 15 (App Router), Auth.js v5, Drizzle ORM, Neon Postgres, Vercel Blob, Turborepo, Commander CLI (`apps/cli`), Vitest.

**Legado (cutover):** Python 3.12, FastAPI, Alembic — `LEGACY_PYTHON=1 ./scripts/run-local.sh`

## SPCA XSD

Schemas em `packages/spca/schemas/`: `origemRecurso.xsd`, `aplicacaoRecurso.xsd`, `doacaoFinanceira.xsd`.
