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

**Env (Gemini via OpenRouter):** `OPENROUTER_API_KEY` (obrigatório); padrão `google/gemini-3.5-flash` em `OPENROUTER_PDF_MODEL`, `OPENROUTER_MODEL` e `OPENROUTER_MODEL_REVIEWER`. Ver [`.env.example`](../.env.example).

**pdf.js no browser:** após `pnpm install`, rode `pnpm --filter web sync-pdf-worker` se `public/pdf.worker.min.mjs` estiver ausente. O app importa `pdfjs-dist/legacy/build/pdf.mjs` via `apps/web/lib/pdfjs-browser.ts`.

**pdf.js no browser:** após `pnpm install`, rode `pnpm --filter web sync-pdf-worker` se `public/pdf.worker.min.mjs` estiver ausente. Import via `apps/web/lib/pdfjs-browser.ts` (build `legacy`, não `build/pdf.mjs`).

**Wizard — mapear extratos:** na etapa 6, o operador associa colunas do PDF por clique na prévia (página 1). O JSON `extratoColumnMap` é enviado no `POST .../paginas/:n/processar` e vira hint no prompt da IA (não persiste em `movimentacao`). Spec: [`docs/superpowers/specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md`](superpowers/specs/2026-06-02-pdf-extrato-mapeamento-colunas-design.md).
