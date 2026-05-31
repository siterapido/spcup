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

**Env (Gemini via OpenRouter):** `OPENROUTER_API_KEY` (obrigatório); opcionais `OPENROUTER_PDF_MODEL` (`google/gemini-3.5-flash`), `OPENROUTER_MODEL_SECONDARY` / `OPENROUTER_MODEL_REVIEWER` (`google/gemini-2.5-pro`). Ver [`.env.example`](../.env.example).
