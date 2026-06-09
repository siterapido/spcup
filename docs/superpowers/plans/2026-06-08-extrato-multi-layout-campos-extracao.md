# Extratos multi-layout — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans para implementar task-by-task. Steps usam checkbox (`- [ ]`).

**Goal:** Extrair todos os campos por layout de PDF (Caixa PIX vs Caixa Total), persistir em `campos_extracao`, exibir união na planilha, consolidar PIX↔Total por chaves duras + nome aproximado (Rem/Dest ↔ Histórico).

**Architecture:** Migration JSONB em `movimentacao`; presets por `ExtratoModeloId`; NotebookLM com schema estendido; consolidação lê `campos_extracao` + `contraparteDoHistorico`; planilha API retorna `colunas` + `camposExtracao` por linha; UI auto-detect modelo no upload.

**Tech Stack:** TypeScript, Drizzle, Vitest, Next.js App Router, NotebookLM.

**Spec:** [2026-06-08-extrato-multi-layout-campos-extracao-design.md](../specs/2026-06-08-extrato-multi-layout-campos-extracao-design.md)

---

## Arquivos (visão geral)

| Área | Arquivos principais |
|------|---------------------|
| DB | `packages/db/drizzle/0014_campos_extracao.sql`, `packages/db/src/schema.ts` |
| Tipos/helpers | `packages/core/src/ingest/campos-extracao.ts`, `extrato-modelo.ts` |
| Presets | `packages/core/src/ingest/extrato-column-map-fixtures.ts` |
| NotebookLM | `packages/core/src/prestacao/process-sessao-notebooklm.ts` |
| Ingest PDF | `packages/core/src/ingest/pdf.ts` (paridade OpenRouter) |
| Consolidação | `packages/core/src/consolidacao/contraparte-historico.ts`, `candidates.ts`, `load.ts`, `queries.ts` |
| Planilha | `packages/core/src/planilha/types.ts`, `list.ts`, `map-consolidacao-linha.ts`, `colunas-sessao.ts` |
| API | `apps/web/app/api/prestacao/sessoes/[id]/processar/route.ts` |
| UI upload | `apps/web/app/prestacao/nova/page.tsx`, `extrato-modelo-select.tsx`, `use-extrato-column-map.ts` |
| UI planilha | `apps/web/components/prestacao/planilha-table.tsx`, `origens-panel.tsx` |
| Testes | `packages/core/src/consolidacao/candidates.test.ts`, `bahia-fixture.test.ts`, `planilha/list.test.ts` |
| Exports | `packages/core/src/index.ts`, `packages/core/src/browser.ts` |

---

### Task 1: Migration DB — `campos_extracao` + `mes_referencia`

**Files:**
- Create: `packages/db/drizzle/0014_campos_extracao.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Modify: `packages/db/src/schema.ts`

- [ ] **Step 1: Escrever migration SQL**

`packages/db/drizzle/0014_campos_extracao.sql`:

```sql
ALTER TABLE movimentacao
  ADD COLUMN IF NOT EXISTS campos_extracao jsonb NOT NULL DEFAULT '{}';

ALTER TABLE sessao_prestacao
  ADD COLUMN IF NOT EXISTS mes_referencia varchar(7);
```

- [ ] **Step 2: Atualizar schema Drizzle**

Em `movimentacao`:

```typescript
camposExtracao: jsonb("campos_extracao").notNull().default({}),
```

Em `sessaoPrestacao`:

```typescript
mesReferencia: varchar("mes_referencia", { length: 7 }),
```

- [ ] **Step 3: Aplicar migration**

```bash
pnpm --filter @spc-up/db migrate
```

Expected: colunas existem; `pnpm exec tsx scripts/list-db-state.ts` sem erro.

- [ ] **Step 4: Commit**

```bash
git add packages/db/
git commit -m "feat(db): campos_extracao e mes_referencia na sessão"
```

---

### Task 2: Tipos e helpers `camposExtracao`

**Files:**
- Create: `packages/core/src/ingest/campos-extracao.ts`
- Create: `packages/core/src/ingest/campos-extracao.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/browser.ts`

- [ ] **Step 1: Escrever testes que falham**

```typescript
// campos-extracao.test.ts
import { describe, expect, it } from "vitest";
import {
  buildCamposExtracaoFromNotebookTx,
  mergeCamposExtracao,
  espelharCamposLegados,
} from "./campos-extracao";

describe("buildCamposExtracaoFromNotebookTx", () => {
  it("mapeia PIX com todos os campos", () => {
    const campos = buildCamposExtracaoFromNotebookTx({
      data: "2025-01-05",
      valor: 150,
      direcao: "CREDITO",
      descricao: "RECEBIDO",
      hora: "14:32",
      tipo_pix: "Recebido",
      situacao: "Efetivado",
      remetente_destinatario: "MARIA SILVA",
      documento: null,
      historico: null,
    });
    expect(campos.remetente_destinatario).toBe("MARIA SILVA");
    expect(campos.hora).toBe("14:32");
  });

  it("mapeia Total com historico e documento", () => {
    const campos = buildCamposExtracaoFromNotebookTx({
      data: "2025-01-05",
      valor: 150,
      direcao: "CREDITO",
      descricao: "PIX RECEBIDO - MARIA SILVA",
      historico: "PIX RECEBIDO - MARIA SILVA",
      documento: "123456",
      saldo: "12500.00",
      remetente_destinatario: null,
    });
    expect(campos.historico).toContain("MARIA");
    expect(campos.documento).toBe("123456");
    expect(campos.remetente_destinatario).toBeUndefined();
  });
});

describe("mergeCamposExtracao", () => {
  it("une chaves de PIX e Total sem sobrescrever", () => {
    const merged = mergeCamposExtracao(
      { remetente_destinatario: "MARIA", hora: "14:00" },
      { historico: "PIX - MARIA", documento: "99" },
    );
    expect(merged.remetente_destinatario).toBe("MARIA");
    expect(merged.historico).toBe("PIX - MARIA");
    expect(merged.documento).toBe("99");
  });
});

describe("espelharCamposLegados", () => {
  it("espelha documento em nrExtratoBancario", () => {
    expect(espelharCamposLegados({ documento: "123" }).nrExtratoBancario).toBe("123");
  });
});
```

- [ ] **Step 2: Implementar módulo**

`campos-extracao.ts` exporta:

- `export type CamposExtracao = Partial<Record<string, string | null>>`
- `buildCamposExtracaoFromNotebookTx(tx)` — só chaves presentes e não-null
- `buildCamposExtracaoFromExtratoItem(item)` — paridade OpenRouter
- `mergeCamposExtracao(a, b)` — merge não-destrutivo (b não apaga chaves de a)
- `espelharCamposLegados(campos)` → `{ remetenteDestinatario, nrExtratoBancario }`
- `campoExtracao(mov, key)` — lê JSON com fallback legado

- [ ] **Step 3: Rodar testes**

```bash
cd packages/core && npm test -- campos-extracao.test.ts
```

Expected: PASS.

- [ ] **Step 4: Exportar em index/browser**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/campos-extracao*
git commit -m "feat(core): helpers campos_extracao"
```

---

### Task 3: Modelos de extrato + preset Caixa Total

**Files:**
- Create: `packages/core/src/ingest/extrato-modelo.ts`
- Create: `packages/core/src/ingest/extrato-modelo.test.ts`
- Modify: `packages/core/src/ingest/extrato-column-map-fixtures.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Testes detectModeloFromFilename**

```typescript
import { detectExtratoModeloFromFilename, extratoColumnMapForModelo } from "./extrato-modelo";

it("detecta caixa_pix", () => {
  expect(detectExtratoModeloFromFilename("Extrato Jan PIX (1).pdf")).toBe("caixa_pix");
});
it("detecta caixa_total", () => {
  expect(detectExtratoModeloFromFilename("EXTRATO TOTAL JANEIRO.pdf")).toBe("caixa_total");
});
it("retorna outro quando ambíguo", () => {
  expect(detectExtratoModeloFromFilename("extrato-janeiro.pdf")).toBe("outro");
});
```

- [ ] **Step 2: Implementar `extrato-modelo.ts`**

```typescript
export type ExtratoModeloId = "caixa_pix" | "caixa_total" | "outro";

export const EXTRATO_MODELO_LABELS: Record<ExtratoModeloId, string> = {
  caixa_pix: "Caixa — Extrato PIX",
  caixa_total: "Caixa — Extrato Total",
  outro: "Outro (mapear manualmente)",
};

export function detectExtratoModeloFromFilename(nome: string): ExtratoModeloId { ... }

export function extratoColumnMapForModelo(id: ExtratoModeloId): ExtratoColumnMap | undefined;
```

- [ ] **Step 3: Adicionar fixture Total**

`extrato-column-map-fixtures.ts`:

```typescript
export const EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN: ExtratoColumnMap = {
  paginaReferencia: 1,
  inferirDirecaoDoValor: true,
  colunas: [
    { campo: "data", colunaIndex: 0, headerLabel: "Data" },
    { campo: "documento", colunaIndex: 1, headerLabel: "Documento" },
    { campo: "historico", colunaIndex: 2, headerLabel: "Histórico" },
    { campo: "valor", colunaIndex: 3, headerLabel: "Valor" },
    { campo: "saldo", colunaIndex: 4, headerLabel: "Saldo" },
  ],
};
```

- [ ] **Step 4: Testes + commit**

```bash
cd packages/core && npm test -- extrato-modelo.test.ts
git commit -m "feat(core): modelos Caixa PIX/Total e preset Total"
```

---

### Task 4: NotebookLM — schema completo + persistência

**Files:**
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.ts`
- Modify: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

- [ ] **Step 1: Estender `NotebookLmTx` e prompt JSON**

Campos novos no schema de transação: `documento`, `historico`, `hora`, `tipo_pix`, `situacao`, `saldo`.

Manter distinção no prompt:

- `documento` = número lançamento extrato (≠ `documento_candidato` CPF/CNPJ)
- `historico` = coluna Histórico integral (Total)
- `remetente_destinatario` = só coluna mapeada (PIX)

- [ ] **Step 2: Atualizar testes existentes**

Ajustar fixtures em `process-sessao-notebooklm.test.ts` para incluir campos novos; assert `camposExtracao` no insert.

- [ ] **Step 3: `persistNotebookLmTransactions`**

Para cada `tx`:

1. `const campos = buildCamposExtracaoFromNotebookTx(tx)`
2. `const legado = espelharCamposLegados(campos)`
3. Insert `camposExtracao: campos`, `nrExtratoBancario: legado.nrExtratoBancario`, `remetenteDestinatario: legado.remetenteDestinatario`
4. `descricaoRaw`: Total → `tx.historico ?? tx.descricao`; PIX → `tx.descricao`
5. `origemExtracao`: se `documento_candidato` válido (11/14 dígitos), gravar `cpfContraparte`/`cnpjContraparte` (não confundir com `documento`)

- [ ] **Step 4: Persistir `extratoModeloId` em metadados**

Ao processar, se `options.extratoModeloIds?.[arquivoId]` ou detect do filename, gravar em `arquivo_ingestao.metadados`.

- [ ] **Step 5: Rodar testes**

```bash
cd packages/core && npm test -- process-sessao-notebooklm.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(notebooklm): extrai e persiste todos os campos do extrato"
```

---

### Task 5: Paridade ingest OpenRouter (`pdf.ts`)

**Files:**
- Modify: `packages/core/src/ingest/pdf.ts`
- Modify: `packages/core/src/ingest/persist.ts` (se existir helper central)

- [ ] **Step 1: Em `rowFromExtratoItem` / persist**

Após montar row, chamar `buildCamposExtracaoFromExtratoItem(item)` e incluir no insert de `movimentacao`.

- [ ] **Step 2: Teste unitário**

Usar item fixture PIX e Total; assert `camposExtracao` keys.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ingest): campos_extracao no pipeline OpenRouter"
```

---

### Task 6: `contraparteDoHistorico` + consolidação

**Files:**
- Create: `packages/core/src/consolidacao/contraparte-historico.ts`
- Create: `packages/core/src/consolidacao/contraparte-historico.test.ts`
- Modify: `packages/core/src/consolidacao/candidates.ts`
- Modify: `packages/core/src/consolidacao/load.ts`
- Modify: `packages/core/src/consolidacao/types.ts`

- [ ] **Step 1: Testes parser Histórico**

```typescript
import { contraparteDoHistorico } from "./contraparte-historico";

expect(contraparteDoHistorico("PIX RECEBIDO - MARIA SILVA")).toBe("MARIA SILVA");
expect(contraparteDoHistorico("TED ENVIADA - JOAO SOUZA")).toBe("JOAO SOUZA");
expect(contraparteDoHistorico("TARIFA PACOTE")).toBeNull();
```

- [ ] **Step 2: Implementar parser Caixa v1**

Regex/prefixos: `PIX RECEBIDO -`, `PIX ENVIADO -`, `TED `, etc. Retornar `normalizeName` ou null.

- [ ] **Step 3: Estender `MovimentacaoCandidate`**

```typescript
camposExtracao?: CamposExtracao;
```

`load.ts`: select `movimentacao.camposExtracao`; parse JSON.

- [ ] **Step 4: Ajustar `pairEligible` e `scorePair`**

```typescript
function remetenteOuHistorico(m: MovimentacaoCandidate, papel: ConsolidacaoLinhaPapel): string {
  if (papel === "COMPLETO") {
    const h = campoExtracao(m, "historico");
    return contraparteDoHistorico(h ?? "") ?? "";
  }
  return remetenteFromMov(m);
}
```

No par PIX↔Total: `nomesBatem(remetentePix, contraparteDoHistorico(historicoTotal))` habilita par.

**Não** gravar resultado em `remetenteDestinatario` do Total.

- [ ] **Step 5: Atualizar `candidates.test.ts`**

Caso: PIX com `remetenteDestinatario`, Total só com `camposExtracao.historico` → 1 evento com 2 linhas.

- [ ] **Step 6: Rodar suite consolidação**

```bash
cd packages/core && npm test -- candidates.test.ts contraparte-historico.test.ts bahia-fixture.test.ts
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(consolidacao): par PIX↔Total via historico aproximado"
```

---

### Task 7: API planilha — `colunas` + `camposExtracao`

**Files:**
- Create: `packages/core/src/planilha/colunas-sessao.ts`
- Modify: `packages/core/src/planilha/types.ts`
- Modify: `packages/core/src/planilha/list.ts`
- Modify: `packages/core/src/planilha/map-consolidacao-linha.ts`
- Modify: `packages/core/src/consolidacao/queries.ts`

- [ ] **Step 1: `colunas-sessao.ts`**

```typescript
export const PLANILHA_COLUNA_ORDER = [
  "data", "documento", "valor", "direcao", "historico",
  "remetente_destinatario", "hora", "tipo_pix", "situacao", "saldo",
] as const;

export function colunasFromModelos(modelos: ExtratoModeloId[]): string[];
export function colunasFromCamposUnion(campos: CamposExtracao[]): string[];
```

União estável; excluir `data`/`valor`/`direcao` duplicados se já colunas fixas da tabela (decidir: `documento` na grade = `Doc./Extrato`).

- [ ] **Step 2: Estender `PlanilhaPayload`**

```typescript
colunas: string[];
```

`PlanilhaLinha`:

```typescript
camposExtracao: CamposExtracao;
```

- [ ] **Step 3: `listPlanilhaForSessao`**

1. Carregar `extratoModeloId` de cada `arquivo_ingestao.metadados` (fallback detect filename).
2. Calcular `colunas`.
3. Em `mapMovimentacaoToLinha` / `mapConsolidacaoEventoToLinha`: preencher `camposExtracao`; no evento fundido, `mergeCamposExtracao` das origens.

- [ ] **Step 4: `queries.ts`**

Incluir `camposExtracao` nas linhas de consolidação (join movimentacao).

- [ ] **Step 5: Testes `list.test.ts`**

Evento 2 origens → `camposExtracao` com chaves PIX + Total.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(planilha): colunas união e camposExtracao por linha"
```

---

### Task 8: UI upload — auto-detect modelo + revisão leve

**Files:**
- Create: `apps/web/components/prestacao/extrato-modelo-select.tsx`
- Modify: `apps/web/hooks/use-extrato-column-map.ts`
- Modify: `apps/web/app/prestacao/nova/page.tsx` (ou wizard upload equivalente)
- Modify: `apps/web/app/api/prestacao/sessoes/[id]/processar/route.ts`

- [ ] **Step 1: Estado por arquivo**

```typescript
modeloByClientKey: Record<string, ExtratoModeloId>;
```

On file add: `detectExtratoModeloFromFilename(file.name)` → preencher modelo + `extratoColumnMapForModelo` em `maps`.

- [ ] **Step 2: Componente `ExtratoModeloSelect`**

Dropdown com labels; badge verde (pix/total detectado) / âmbar (`outro`).

Ao mudar modelo: aplicar preset map (PIX ou Total) ou limpar para manual.

- [ ] **Step 3: Gate Processar**

Desabilitar se algum PDF `outro` sem `validateExtratoColumnMapPerPdf` ok **ou** sem modelo escolhido.

- [ ] **Step 4: Body processar**

```typescript
{
  extratoColumnMaps: Record<arquivoId, ExtratoColumnMap>,
  extratoModeloIds?: Record<arquivoId, ExtratoModeloId>,
  mesReferencia?: string,  // Task 9
}
```

- [ ] **Step 5: Smoke manual**

Upload PIX + Total → modelos pré-selecionados corretos → Processar.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): seleção modelo extrato com auto-detect"
```

---

### Task 9: Mês referência (rótulo)

**Files:**
- Modify: `packages/core/src/prestacao/sessao.ts` (create)
- Modify: API criar sessão + planilha page header
- Modify: `apps/web/app/prestacao/nova/page.tsx`

- [ ] **Step 1: Aceitar `mesReferencia?: string` (`YYYY-MM`) ao criar sessão**

Validar regex; opcional.

- [ ] **Step 2: Exibir na planilha**

Ex.: `Prestação BA 2025 — Janeiro/2025` quando `mesReferencia = 2025-01`.

- [ ] **Step 3: Confirmar que não filtra dados**

Sem lógica em `listPlanilhaForSessao`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(sessao): mes_referencia opcional como rótulo"
```

---

### Task 10: UI planilha — colunas dinâmicas

**Files:**
- Modify: `apps/web/components/prestacao/planilha-table.tsx`
- Modify: `apps/web/components/prestacao/origens-panel.tsx`
- Modify: `apps/web/lib/planilha-linha-from-evento.ts` (se usado)

- [ ] **Step 1: Cabeçalhos dinâmicos**

Iterar `payload.colunas` com labels PT (`PLANILHA_COLUNA_LABELS`).

- [ ] **Step 2: Células**

`linha.camposExtracao[col] ?? "—"` para colunas extras; manter colunas fixas de produto (PF/PJ, Confiança, Origens, Status).

- [ ] **Step 3: Origens panel**

Listar todos os pares chave/valor de `camposExtracao` por origem.

- [ ] **Step 4: Filtro "Sem remetente/destinatário"**

Ajustar: linha fundida com origem PIX com `remetente_destinatario` não conta como sem.

- [ ] **Step 5: `tsc` web**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): planilha com colunas união dos extratos"
```

---

### Task 11: Verificação E2E e docs

**Files:**
- Modify: `scripts/test-remetente-match-e2e.ts` (ou novo script PIX+Total)
- Modify: `AGENTS.md`, `docs/dev-scripts.md`

- [ ] **Step 1: Atualizar/criar script E2E**

Processar sessão com:

- `Extrato Jan PIX (1).pdf` + `EXTRATO TOTAL JANEIRO (1) (1).pdf`
- `extratoModeloIds` + maps PIX/Total
- Assert: `campos_extracao` preenchido; maioria eventos com 2 origens; `documento` no Total; `historico` visível

```bash
pnpm exec tsx scripts/test-remetente-match-e2e.ts
# ou script dedicado test-pix-total-planilha-e2e.ts
```

- [ ] **Step 2: Suite core completa**

```bash
cd packages/core && npm test
```

Expected: 306+ pass (novos testes inclusos).

- [ ] **Step 3: Atualizar AGENTS.md**

- Presets `EXTRATO_COLUMN_MAP_CAIXA_PIX_JAN` e `EXTRATO_COLUMN_MAP_CAIXA_TOTAL_JAN`
- `campos_extracao` JSON
- Match Histórico ↔ Rem/Dest na consolidação (não na ingestão)

- [ ] **Step 4: Commit final**

```bash
git add AGENTS.md docs/
git commit -m "docs: planilha multi-layout e critérios E2E PIX+Total"
```

---

## Critérios de aceite (checklist)

- [ ] Migration aplicada; `campos_extracao` em todas as movimentações novas
- [ ] PIX: `remetente_destinatario`, `hora`, `tipo_pix` em `campos_extracao`
- [ ] Total: `historico`, `documento`, `saldo` em `campos_extracao`; Rem/Dest null
- [ ] Planilha mostra colunas união (incl. Histórico, Doc./Extrato)
- [ ] Maioria dos pares PIX↔Total com **2 origens**
- [ ] Histórico **não** copiado para `remetente_destinatario` do Total
- [ ] Auto-detect modelo + dropdown editável antes de processar
- [ ] `mes_referencia` só no rótulo
- [ ] `cd packages/core && npm test` verde
- [ ] `pnpm --filter web exec tsc --noEmit` verde

---

## Ordem de dependências

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
                              ↓
                         Task 6 → Task 7 → Task 10
                              ↓
                    Task 8, 9 (paralelo após Task 3)
                              ↓
                         Task 11
```

Tasks 8–9 podem começar após Task 3 (presets); Tasks 10–11 após Task 7.
