# Deploy SPC UP — Vercel + Neon + Blob

Guia passo a passo para publicar `apps/web` na Vercel com Postgres (Neon) e armazenamento de uploads (Vercel Blob).

## Pré-requisitos

- Conta [Vercel](https://vercel.com) com acesso ao time/repositório `unidade-popular/spc-up`
- [pnpm](https://pnpm.io) 9+ localmente (para validar build/migrations antes do deploy)
- Repositório clonado e `pnpm install` na raiz

## 1. Vincular projeto Vercel (`apps/web`)

O monorepo usa `vercel.json` na raiz com **Root Directory** `apps/web` e região **`gru1`** (São Paulo).

1. No dashboard Vercel: **Add New → Project** → importe o repositório Git.
2. Em **Root Directory**, selecione **`apps/web`** (ou confirme que o Vercel leu `vercel.json` na raiz do repo).
3. **Framework Preset:** Next.js.
4. **Build Command:** `pnpm --filter web build` (já em `vercel.json`).
5. **Install Command:** `pnpm install` (raiz do monorepo).
6. Salve e faça o primeiro deploy (pode falhar até as env vars estarem configuradas).

Alternativa CLI (na raiz do repo):

```bash
pnpm dlx vercel link
# Escolha o time; confirme apps/web como root se perguntado
```

## 2. Integração Neon (variáveis de ambiente)

1. No projeto Vercel: **Storage → Create Database → Neon** (ou **Integrations → Neon**).
2. Crie/vincule um banco Postgres; a integração injeta automaticamente:
   - `DATABASE_URL` — conexão **pooled** (runtime Next.js / serverless)
   - `DATABASE_URL_UNPOOLED` — conexão direta para **migrations Drizzle**
3. Em **Settings → Environment Variables**, confirme que ambas existem em **Production** e **Preview**.

Localmente, copie os valores para `.env` na raiz (ou `apps/web/.env.local` para só a web):

```bash
cp .env.example .env
# Cole DATABASE_URL e DATABASE_URL_UNPOOLED do painel Neon/Vercel
```

## 3. Vercel Blob (`BLOB_READ_WRITE_TOKEN`)

1. **Storage → Blob → Create Store** (ou integração Blob no projeto).
2. Gere/copie o token **Read-Write** e defina:

| Variável | Ambientes |
|----------|-----------|
| `BLOB_READ_WRITE_TOKEN` | Production, Preview, Development (opcional local) |

Sem este token, a rota de upload (`/api/upload`) falha ao gravar arquivos.

## 4. Demais variáveis obrigatórias

| Variável | Descrição |
|----------|-----------|
| `AUTH_SECRET` | Segredo Auth.js (`openssl rand -base64 32`) |
| `AUTH_URL` | URL canônica do app (ver seção 6) |
| `OPENROUTER_API_KEY` | Ingestão de PDF via OpenRouter |
| `OPENROUTER_MODEL` | Ex.: `anthropic/claude-sonnet-4` |
| `ADMIN_EMAIL` | E-mail do admin inicial (seed) |
| `ADMIN_PASSWORD` | Senha do admin inicial (seed) |

Opcional: `CONFIANCA_LIMIAR_ALTA=0.85`, `STORAGE_ROOT` (só CLI/legado local).

## 5. Migrations e seeds (antes ou após primeiro deploy)

Execute **na sua máquina** ou em CI com `DATABASE_URL` / `DATABASE_URL_UNPOOLED` apontando para o Neon de **produção** (ou um branch Neon de staging):

```bash
pnpm install
pnpm db:migrate          # Drizzle — usa DATABASE_URL_UNPOOLED ?? DATABASE_URL
pnpm seed:diretorios     # 27 UFs + CNPJs placeholder
pnpm seed:admin          # usuário ADMIN_EMAIL / ADMIN_PASSWORD
```

Ordem recomendada: **migrate → diretórios → admin**.

> Substitua CNPJs placeholder nos diretórios piloto antes de exportar XML ao SPCA.

## 6. `AUTH_URL` — Preview vs Production

Auth.js precisa da URL pública exata do deployment:

| Ambiente | `AUTH_URL` |
|----------|------------|
| **Production** | `https://seu-dominio.vercel.app` ou domínio customizado |
| **Preview** | URL do deployment preview (ex. `https://spc-up-git-feature-xxx.vercel.app`) — **uma variável por branch não é automática**; use o domínio preview padrão do Vercel ou configure [System Environment Variables](https://vercel.com/docs/projects/environment-variables/system-environment-variables) como `VERCEL_URL` com `AUTH_URL=https://${VERCEL_URL}` se o adapter suportar expansão no dashboard |

Prática comum:

- **Production:** `AUTH_URL=https://spc-up.unidadepopular.org.br` (exemplo)
- **Preview:** marque **Preview** no Vercel e defina `AUTH_URL` vazio + `AUTH_TRUST_HOST=true` já está em `auth.config.ts` (`trustHost: true`) — ou defina manualmente após cada preview se necessário

Local: `AUTH_URL=http://localhost:3000` (`apps/web/.env.example`).

## 7. Região `gru1`

`vercel.json` na raiz fixa:

```json
"regions": ["gru1"]
```

Isso coloca Serverless Functions na região de São Paulo (menor latência para usuários no Brasil). Confirme no plano Vercel que a região está disponível; se o deploy reclamar, ajuste temporariamente e reabra issue de infra.

## 8. Deploy e verificação

1. Push na branch conectada → deploy automático.
2. Após env vars + seeds: acesse `/login`, entre com `ADMIN_EMAIL`.
3. Dashboard `/` → upload de teste → `/movimentacoes`.
4. CLI contra o mesmo Neon:

```bash
pnpm --filter @spc-up/cli build
DATABASE_URL="..." pnpm spc-up pendencias --uf SP --exercicio 2025
```

## 9. Migração de dados legados (opcional)

- Banco on-prem → Neon: `scripts/migrate-db.md`
- Arquivos `./data/uploads` → Blob: `pnpm migrate-storage`
- Conferência de linhas: `pnpm verify-counts`

## Referências

- Design: `docs/superpowers/specs/2026-05-25-nextjs-vercel-neon-migration-design.md`
- Piloto: `docs/piloto-checklist.md`
- `vercel.json`, `.env.example`, `apps/web/.env.example`
