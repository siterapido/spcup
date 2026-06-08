# Scripts de desenvolvimento (não fazem parte do produto)

Estes scripts existem para depuração local. Usuários finais usam **web** + **`spcup` CLI**.

| Script | Uso |
|--------|-----|
| `scripts/debug-ingest.ts` | Replay de ingestão de um arquivo |
| `scripts/debug-pdf-page.ts` | Uma página de PDF + dual-extract |
| `scripts/replay-ingest-page.ts` | Reprocessar página já persistida |
| `scripts/run-test-docs-ingest.ts` | Smoke nos PDFs em `Documentos para teste /` — `pnpm exec tsx scripts/run-test-docs-ingest.ts [arquivo.pdf]` |
| `scripts/list-db-state.ts` | Inspecionar contagem no Postgres |
| `scripts/limpar-transacoes.ts` | Limpar transações de teste |
| `scripts/wipe-domain.ts` | Wipe domínio (sessões, movimentações, pessoas). Requer `ALLOW_DOMAIN_WIPE=1`. No deploy `remetente_destinatario`, rodar **antes** da migration — ver [Deploy remetente_destinatario](#deploy-remetente_destinatario) |
| `scripts/test-remetente-match-e2e.ts` | E2E remetente/destinatário + match cadastro (PDF Caixa PIX + pessoas BA). `pnpm exec tsx scripts/test-remetente-match-e2e.ts` |

**Env (Gemini via OpenRouter):** `OPENROUTER_API_KEY` (obrigatório); padrão `google/gemini-3.5-flash` em `OPENROUTER_PDF_MODEL`, `OPENROUTER_MODEL` e `OPENROUTER_MODEL_REVIEWER`. Ver [`.env.example`](../.env.example).

**pdf.js no browser:** após `pnpm install`, rode `pnpm --filter web sync-pdf-worker` se `public/pdf.worker.min.mjs` estiver ausente. O app importa `pdfjs-dist/legacy/build/pdf.mjs` via `apps/web/lib/pdfjs-browser.ts`.

**pdf.js no browser:** após `pnpm install`, rode `pnpm --filter web sync-pdf-worker` se `public/pdf.worker.min.mjs` estiver ausente. Import via `apps/web/lib/pdfjs-browser.ts` (build `legacy`, não `build/pdf.mjs`).

**Wizard — mapear extratos:** na etapa 6, o operador associa colunas do PDF por clique na prévia (página 1). O JSON `extratoColumnMap` é enviado no `POST .../paginas/:n/processar` e vira hint no prompt da IA (não persiste em `movimentacao`). Spec: [`docs/superpowers/specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md`](superpowers/specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md).

## Deploy remetente_destinatario

Ordem obrigatória no deploy desta feature:

1. `ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts`
2. `pnpm --filter @spc-up/db migrate`
3. Deploy app

**Smoke pós-deploy:**

1. Importar cadastro pessoas
2. Nova prestação com PDF coluna Remetente/Destinatário
3. Mapear coluna `remetente_destinatario`
4. Processar → planilha exibe coluna preenchida
5. Vincular PF/PJ → indicador verde/âmbar de match

Alternativa smoke automatizada: `pnpm exec tsx scripts/test-remetente-match-e2e.ts` (requer `Documentos para teste /` + env DB/OpenRouter).
