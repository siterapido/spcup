# Instruções para agentes — SPC UP

## Verificação

Antes de afirmar que remetente/destinatário funciona:

1. `pnpm --filter @spc-up/db migrate` — coluna `remetente_destinatario` existe
2. `pnpm --filter @spc-up/core test` — 349+ tests pass (source nvm primeiro: `source ~/.nvm/nvm.sh`)
3. `pnpm --filter web exec tsc --noEmit` — sem erros (ignorar erros de drizzle-orm mysql/singlestore — preexistentes)
4. E2E opcional: `pnpm exec tsx scripts/test-remetente-match-e2e.ts` (NotebookLM + ~3 min; exige `nlm`, cadastro BA, PDF em `Documentos para teste /`)

Critérios E2E OK: 100% linhas com `remetenteDestinatario`; maioria com PF/PJ; `compararNomeCadastro` majoritariamente `bate` (inclui abreviações de nome do meio no cadastro).

Mapa referência Caixa PIX: importar `EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN` de `@spc-up/core`.

## Convenções

- Planilha/API: `remetenteDestinatario` (camelCase TS); DB/mapa IA: `remetente_destinatario`
- Não reintroduzir `nomeContraparte`, `deriveNomeContraparte` em ingest/planilha
- `pessoa.nome` no cadastro ≠ campo remetente — são conceitos distintos
- Commits só quando o usuário pedir

## Fluxo prestação (resumo)

1. Importar pessoas UF
2. Wizard: anexar PDF → mapear `remetente_destinatario` (obrigatório na sessão)
3. `POST .../processar` com `extratoColumnMaps`
4. Planilha: coluna Remetente/Destinatário + bolinha verde/âmbar vs cadastro

See also: [CLAUDE.md](./CLAUDE.md)
