# Extrato base na consolidação — Implementation Plan

**Goal:** Planilha consolidada base-driven — 1 linha por movimentação do extrato Total oficial; PIX enriquece nome; órfãos PIX em painel; base confirmado no wizard.

**Architecture:** Coluna `sessao_prestacao.arquivo_base_ingestao_id`; refactor `buildConsolidacaoCandidates` para iterar movs do base; match PIX tiered (doc↔hora → fallback); UI radio + recalcular modal.

**Tech Stack:** TypeScript, Drizzle, Neon Postgres, Next.js App Router, Vitest.

**Spec:** [docs/superpowers/specs/2026-06-11-extrato-base-consolidacao-design.md](../specs/2026-06-11-extrato-base-consolidacao-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/schema.ts` | `sessaoPrestacao.arquivoBaseIngestaoId` |
| `packages/db/drizzle/0015_*.sql` | Migration |
| `packages/core/src/prestacao/sessao.ts` | Ler/gravar `arquivoBaseIngestaoId` |
| `packages/core/src/consolidacao/run.ts` | Gatilho por base, não `pdfCount < 2` |
| `packages/core/src/consolidacao/candidates.ts` | Grão base-driven, merge campos, órfãos |
| `packages/core/src/consolidacao/candidates.test.ts` | Fixtures base+PIX, só-base, órfãos |
| `packages/core/src/consolidacao/classify-arquivo.ts` | Papel via `extratoModeloId` + base id |
| `packages/core/src/consolidacao/orfaos-pix.ts` | **Novo** — listar PIX sem par |
| `packages/core/src/consolidacao/persist.ts` | `deleteAllConsolidacaoEvents` |
| `packages/core/src/planilha/map-consolidacao-linha.ts` | `dataMovimento` já do evento; validar Rem/Dest PIX |
| `packages/core/src/index.ts` | Re-exports |
| `apps/web/components/prestacao/wizard.tsx` | Radio extrato base |
| `apps/web/hooks/use-prestacao-submit.ts` | Enviar `arquivoBaseIngestaoId` |
| `apps/web/app/api/prestacao/sessoes/[id]/processar/route.ts` | Persistir base no processar |
| `apps/web/app/api/prestacao/sessoes/[id]/route.ts` | PATCH `arquivoBaseIngestaoId` |
| `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/recalcular/route.ts` | **Novo** — modal backend |
| `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/orfaos-pix/route.ts` | **Novo** — GET órfãos |
| `apps/web/components/prestacao/consolidacao-planilha.tsx` | Painel órfãos + botão recalcular |
| `packages/core/src/consolidacao/bahia-fixture.test.ts` | Atualizar expectativa ~36 eventos |

---

## Task 1: Schema — `arquivo_base_ingestao_id`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0015_sessao_arquivo_base.sql`

- [ ] **Step 1:** Adicionar em `sessaoPrestacao`:

```typescript
arquivoBaseIngestaoId: uuid("arquivo_base_ingestao_id").references(
  () => arquivoIngestao.id,
),
```

- [ ] **Step 2:** Gerar/aplicar migration: `pnpm --filter @spc-up/db migrate`

- [ ] **Step 3:** Commit: `feat(db): sessao arquivo_base_ingestao_id`

---

## Task 2: Sessão — tipos e persistência

**Files:**
- Modify: `packages/core/src/prestacao/sessao.ts`
- Modify: `packages/core/src/prestacao/process-sessao.ts`
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts`

- [ ] **Step 1:** `getSessao` / tipos exportam `arquivoBaseIngestaoId: string | null`

- [ ] **Step 2:** `ProcessSessaoPdfOptions`:

```typescript
arquivoBaseIngestaoId?: string;
```

- [ ] **Step 3:** Ao iniciar processamento, `UPDATE sessao_prestacao SET arquivo_base_ingestao_id = $id` quando informado

- [ ] **Step 4:** Helper `resolveArquivoBaseId(sessao, arquivos, extratoModeloIds)`:
  - 1 `caixa_total` → auto
  - 0 → null (consolidação skip)
  - 2+ → exige `arquivoBaseIngestaoId` explícito ou erro validação

- [ ] **Step 5:** Testes unitários do helper

- [ ] **Step 6:** Commit: `feat(core): persistir extrato base na sessão`

---

## Task 3: Refactor `buildConsolidacaoCandidates` (grão base)

**Files:**
- Modify: `packages/core/src/consolidacao/candidates.ts`
- Modify: `packages/core/src/consolidacao/types.ts`
- Modify: `packages/core/src/consolidacao/candidates.test.ts`

- [ ] **Step 1:** Assinatura:

```typescript
export function buildConsolidacaoCandidates(
  movs: MovimentacaoCandidate[],
  ctx: CadastroMatchContext,
  options: { arquivoBaseIngestaoId: string },
): { drafts: ConsolidacaoEventDraft[]; pixOrfaos: MovimentacaoCandidate[] }
```

- [ ] **Step 2:** Particionar:
  - `baseMovs` = filtro `arquivoIngestaoId === base`
  - `pixMovs` = `extratoModeloId === caixa_pix` (ou metadados) e ≠ base

- [ ] **Step 3:** Matching PIX→base (tier 1 + tier 2), greedy 1:1 — reutilizar `scorePair`, `pixTotalDocumentoHoraMatch`, `pairEligible`

- [ ] **Step 4:** Para cada `baseMov`:
  - Com PIX: evento 2 linhas; `dataMovimento/valor/direcao` do **base**
  - Sem PIX: evento 1 linha; `scoreSingle` + parse histórico só cadastro (decisão 6-B)

- [ ] **Step 5:** PIX restantes → `pixOrfaos` (não criar evento)

- [ ] **Step 6:** Remover loop final que cria evento para todo `mov` não usado (comportamento união)

- [ ] **Step 7:** Testes:
  - Bahia fixture: 36 drafts, datas do Total
  - Só base: N singles
  - 2 PIX mesmo valor: FIFO
  - Órfão PIX não vira draft

- [ ] **Step 8:** Commit: `refactor(consolidacao): grão base-driven`

---

## Task 4: `consolidateSession` + persist recalcular

**Files:**
- Modify: `packages/core/src/consolidacao/run.ts`
- Modify: `packages/core/src/consolidacao/persist.ts`

- [ ] **Step 1:** Substituir `pdfCount < 2` por:

```typescript
if (!sessao.arquivoBaseIngestaoId) {
  return { skipped: true, reason: "NO_BASE" };
}
```

- [ ] **Step 2:** Passar `arquivoBaseIngestaoId` para `buildConsolidacaoCandidates`

- [ ] **Step 3:** Adicionar `deleteAllConsolidacaoEvents(db, sessaoId)` — delete todos status

- [ ] **Step 4:** Export `recalcularConsolidacao(db, sessaoId, { manterAprovados: boolean })`

- [ ] **Step 5:** Teste: recalcular default apaga aprovados; com flag mantém

- [ ] **Step 6:** Commit: `feat(consolidacao): gatilho por base e recalcular`

---

## Task 5: Papel via modelo (não só filename)

**Files:**
- Modify: `packages/core/src/consolidacao/classify-arquivo.ts`
- Modify: `packages/core/src/consolidacao/load.ts` — carregar `extratoModeloId` nos candidates

- [ ] **Step 1:** `resolveLinhaPapel(mov, arquivoBaseIngestaoId): ConsolidacaoLinhaPapel`:
  - `mov.arquivoIngestaoId === base` → `COMPLETO`
  - `extratoModeloId === caixa_pix` → `PIX`
  - else → `OUTRO`

- [ ] **Step 2:** Manter `classifyArquivoPapel` como fallback se metadados ausentes

- [ ] **Step 3:** Commit: `fix(consolidacao): papel por extratoModeloId`

---

## Task 6: Órfãos PIX — core + API

**Files:**
- Create: `packages/core/src/consolidacao/orfaos-pix.ts`
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/orfaos-pix/route.ts`

- [ ] **Step 1:** `listPixOrfaos(db, sessaoId)` — roda matching ou lê último resultado cacheado

- [ ] **Step 2:** GET retorna `{ total, itens: [{ movimentacaoId, data, valor, direcao, remetenteDestinatario, nomeArquivo }] }`

- [ ] **Step 3:** Commit: `feat(consolidacao): endpoint órfãos PIX`

---

## Task 7: API processar + PATCH sessão

**Files:**
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/processar/route.ts`
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/route.ts`

- [ ] **Step 1:** Body `processar`: `arquivoBaseIngestaoId?: string` (uuid)

- [ ] **Step 2:** Validar: id pertence à sessão e modelo `caixa_total`

- [ ] **Step 3:** PATCH sessão aceita troca de base (sem recalcular automático)

- [ ] **Step 4:** Commit: `feat(api): arquivo base no processar e PATCH`

---

## Task 8: API recalcular

**Files:**
- Create: `apps/web/app/api/prestacao/sessoes/[id]/consolidacao/recalcular/route.ts`

- [ ] **Step 1:** POST body `{ manterAprovados?: boolean }` default `false`

- [ ] **Step 2:** Chama `recalcularConsolidacao`

- [ ] **Step 3:** `revalidatePath` planilha + consolidacao

- [ ] **Step 4:** Commit: `feat(api): POST consolidacao/recalcular`

---

## Task 9: Wizard UI

**Files:**
- Modify: `apps/web/components/prestacao/wizard.tsx`
- Modify: `apps/web/hooks/use-prestacao-submit.ts`
- Modify: `apps/web/components/prestacao/extrato-column-map-panel.tsx` (se lista arquivos)

- [ ] **Step 1:** Estado `arquivoBaseIngestaoId: string | null`

- [ ] **Step 2:** Auto-set quando 1 `caixa_total` nos uploads

- [ ] **Step 3:** Radio group quando 2+ `caixa_total`; desabilita Processar se null

- [ ] **Step 4:** Badge “Extrato base” no arquivo selecionado

- [ ] **Step 5:** Incluir no payload `processar`

- [ ] **Step 6:** Commit: `feat(web): wizard radio extrato base`

---

## Task 10: UI consolidação — painel órfãos + recalcular

**Files:**
- Modify: `apps/web/components/prestacao/consolidacao-planilha.tsx`
- Opcional: `apps/web/components/prestacao/recalcular-consolidacao-dialog.tsx`

- [ ] **Step 1:** Fetch órfãos PIX; Alert colapsável com tabela

- [ ] **Step 2:** Badge no header se `total > 0`

- [ ] **Step 3:** Botão “Recalcular consolidação” → AlertDialog:
  - Aviso default apaga aprovações
  - Checkbox “Manter eventos já aprovados”

- [ ] **Step 4:** Se sessão tem 2+ Total, dropdown trocar base → PATCH → sugere recalcular

- [ ] **Step 5:** Commit: `feat(web): painel órfãos PIX e recalcular`

---

## Task 11: Planilha + bahia fixture

**Files:**
- Modify: `packages/core/src/planilha/map-consolidacao-linha.ts`
- Modify: `packages/core/src/consolidacao/bahia-fixture.test.ts`

- [ ] **Step 1:** Garantir `remetenteDestinatario` prioriza linha PIX nas linhas do evento (não merge JSON base)

- [ ] **Step 2:** Atualizar fixture: expect ~36 linhas, datas Total, órfãos ≥ 0

- [ ] **Step 3:** Commit: `test(consolidacao): bahia base-driven`

---

## Task 12: Docs operacionais

**Files:**
- Modify: `CLAUDE.md` — gotcha extrato base
- Modify: `AGENTS.md` — verificação

- [ ] **Step 1:** Entrada curta: base = Total, PIX = nome, `arquivo_base_ingestao_id`

- [ ] **Step 2:** Commit: `docs: extrato base consolidação`

---

## Verification (obrigatório antes de merge)

```bash
pnpm --filter @spc-up/db migrate
source ~/.nvm/nvm.sh && pnpm --filter @spc-up/core test
pnpm --filter web exec tsc --noEmit
```

Opcional E2E:

```bash
pnpm exec tsx scripts/test-remetente-match-e2e.ts
```

**Critérios:**
- Core tests pass (incl. `candidates.test.ts`, `bahia-fixture.test.ts`)
- Sessão Bahia: planilha ≈ linhas do Total; Rem/Dest majoritariamente do PIX
- PIX órfãos visíveis no painel quando aplicável

---

## Ordem sugerida

1. Task 1–2 (schema + sessão)
2. Task 3–5 (core matching — maior risco)
3. Task 4 (run + recalcular)
4. Task 6–8 (APIs)
5. Task 9–10 (UI)
6. Task 11–12 (testes + docs)

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Sessões existentes sem `arquivo_base_ingestao_id` | Backfill: único `caixa_total` na sessão; senão operador reconfirma |
| Aprovados invalidados no recalcular default | Modal explícito (decisão 12-C) |
| `pair.a.dataMovimento` regressão | Assert em bahia-fixture |
