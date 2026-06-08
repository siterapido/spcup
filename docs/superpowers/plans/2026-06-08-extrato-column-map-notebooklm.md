# Mapeamento de colunas + NotebookLM — Plan

**Spec:** `docs/superpowers/specs/2026-06-08-extrato-column-map-notebooklm-design.md`

## Tasks (5 subagents)

1. **core-validation-hint** — `extrato-column-map.ts` validation + `buildNotebookLmExtratoPrompt` + tests
2. **notebooklm-pipeline** — `processSessaoWithNotebookLM` + metadados migration + tests
3. **api-submit** — `processar/route.ts` + `use-prestacao-submit.ts` + `process-sessao.ts` options pass-through
4. **wizard-ux** — `wizard.tsx` + `use-extrato-column-map.ts` copy layout + canSubmit
5. **panel-direcao** — `extrato-column-map-client.ts` direção detect + panel UX for required fields
