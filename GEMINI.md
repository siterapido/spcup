# SPC UP — contexto do projeto

> Mantenha em sincronia com [CLAUDE.md](./CLAUDE.md).

## Stack

- Monorepo pnpm: `packages/core`, `packages/db`, `apps/web`, `apps/cli`
- Postgres (Neon), Drizzle ORM, Next.js App Router, NotebookLM (`nlm` CLI) ou OpenRouter para extratos PDF

## Commands

- `pnpm --filter @spc-up/db migrate` — aplicar migrations (obrigatório após pull com schema novo)
- `ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts` — wipe domínio operacional (sessões, pessoas, movimentações)
- `pnpm exec tsx scripts/test-remetente-match-e2e.ts` — E2E: mapa `remetente_destinatario` + match cadastro (NotebookLM + `Documentos para teste /`)
- `pnpm exec tsx scripts/list-db-state.ts` — contagens no banco
- `cd packages/core && npm test` — suite core

## Gotchas

- Coluna DB é `remetente_destinatario` (migration `0013`). Código/schema antigo com `nome_contraparte` quebra até migrar.
- PDFs em `Documentos para teste /` são **escaneados** (`extractPdfText` → 0 chars). Ingest usa **NotebookLM** (`USE_NOTEBOOKLM=true`), não texto local.
- Mapa de colunas com `campo: "nome"` é **rejeitado**; usar `remetente_destinatario`. Mapas antigos exigem remapear no wizard.
- `remetenteDestinatario` vem **só** da coluna mapeada ou edição manual — sem derivação de histórico/PIX.
- Extrato Caixa PIX (`Extrato Jan PIX (1).pdf`): índices validados em E2E — `data=0, valor=1, documento=2, remetente_destinatario=3, historico=4`, `inferirDirecaoDoValor: true`.
- Cadastro BA: `pessoas bahia (1).xlsx` — headers `nome`, `documento`, `tipo` (257 linhas).
- Nomes no cadastro às vezes abreviam nomes do meio (`GABRIELLE D PIMENTEL` vs extrato `GABRIELLE DIAS PIMENTEL`); `compararNomeCadastro` trata iniciais de 1 letra.
- Fixture mapa Caixa PIX: `EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN` em `packages/core/src/ingest/extrato-column-map-fixtures.ts`.

## Docs

- Spec/plano remetente: `docs/superpowers/specs/2026-06-08-remetente-destinatario-design.md`, `docs/superpowers/plans/2026-06-08-remetente-destinatario.md`
- Deploy: `docs/dev-scripts.md#deploy-remetente_destinatario`

See also: [AGENTS.md](./AGENTS.md)
