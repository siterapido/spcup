# Comparador PDF consolidação — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Lançar 5 subagentes** conforme seções abaixo; respeitar grafo de dependências.

**Goal:** Operador compara PIX e COMPLETO lado a lado na planilha, com linha destacada no PDF (proveniência ou heurística valor+data), e resolve merge pendente no rodapé do modal.

**Architecture:** Heurística pura em `packages/core/src/pdf-locate/`; UI extrai painel único de `pdf-origem-viewer.tsx`; modal `pdf-comparador-modal.tsx` orquestra 2 painéis; `planilha-table.tsx` ganha botão **Comparar PDFs**. Sem rotas API novas — estender `PlanilhaOrigem` com `origemExtracao` opcional.

**Tech Stack:** TypeScript, Vitest (`packages/core`), Next.js App Router, pdf.js (`apps/web/lib/pdfjs-browser.ts`), Tailwind.

**Spec:** [2026-06-08-comparador-pdf-consolidacao-design.md](../specs/2026-06-08-comparador-pdf-consolidacao-design.md)

---

## Grafo de subagentes

```
Subagent 1 (core heurística) ──┐
                                 ├──► Subagent 3 (comparador modal) ──► Subagent 4 (planilha)
Subagent 2 (pdf painel) ───────┘              │
                                                └──► Subagent 5 (refactor + consolidacao)
```

| Ordem | Subagente | Pode paralelo com |
|-------|-----------|-------------------|
| 1 | Core heurística | Subagent 2 |
| 2 | PDF painel | Subagent 1 |
| 3 | Comparador modal | — (após 1+2) |
| 4 | Planilha integration | — (após 3) |
| 5 | Refactor viewer + ConsolidacaoPlanilha | — (após 2+3; pode overlap final com 4) |

---

## Mapa de arquivos

| Arquivo | Ação | Subagente |
|---------|------|-----------|
| `packages/core/src/pdf-locate/localizar-linha-pdf.ts` | Criar | 1 |
| `packages/core/src/pdf-locate/localizar-linha-pdf.test.ts` | Criar | 1 |
| `packages/core/src/pdf-locate/types.ts` | Criar | 1 |
| `packages/core/src/index.ts` | Modificar — export | 1 |
| `packages/core/src/browser.ts` | Modificar — re-export tipos se necessário | 1 |
| `apps/web/hooks/use-pdf-text-layer.ts` | Criar | 2 |
| `apps/web/components/prestacao/pdf-origem-painel.tsx` | Criar | 2 |
| `apps/web/components/prestacao/pdf-comparador-modal.tsx` | Criar | 3 |
| `apps/web/lib/pdf-origem-panel-utils.ts` | Criar — seleção PIX/COMPLETO | 3 |
| `packages/core/src/planilha/types.ts` | Modificar — `origemExtracao?` em `PlanilhaOrigem` | 4 |
| `packages/core/src/planilha/list.ts` | Modificar — popular `origemExtracao` nas origens | 4 |
| `packages/core/src/planilha/list.test.ts` | Modificar — assert origemExtracao | 4 |
| `apps/web/components/prestacao/planilha-table.tsx` | Modificar — Comparar PDFs + modal | 4 |
| `apps/web/components/prestacao/pdf-origem-viewer.tsx` | Modificar — delegar ao painel | 5 |
| `apps/web/components/prestacao/consolidacao-planilha.tsx` | Modificar — reutilizar comparador (opcional v1) | 5 |

---

## Subagent 1 — Core: heurística `localizarLinhaPdf`

**Dependências:** nenhuma  
**Paralelo com:** Subagent 2

### Objetivo

Função pura que recebe text layer por página e retorna `{ pagina, bbox }` quando valor **e** data aparecem no mesmo trecho de linha; `descricaoRaw` desempata múltiplos matches.

### Arquivos

- Create: `packages/core/src/pdf-locate/types.ts`
- Create: `packages/core/src/pdf-locate/localizar-linha-pdf.ts`
- Create: `packages/core/src/pdf-locate/localizar-linha-pdf.test.ts`
- Modify: `packages/core/src/index.ts`

### Passos

- [ ] **1.1 Tipos** — `PdfTextItem`, `PdfPaginaTexto`, `LocalizarLinhaPdfInput`, `LocalizarLinhaPdfResult`, reutilizar `BboxNorm` de proveniência existente.

- [ ] **1.2 Testes (TDD)** — casos da spec §5.4:
  - match valor+data mesma linha
  - valor linha A + data linha B → `encontrado: false`
  - 2 linhas mesmo valor → desempate por tokens `descricaoRaw`
  - formatos `1.500,00` / `R$ 1500.00` / `15/01/2025`
  - match na página 2

- [ ] **1.3 Implementar `agruparItensEmLinhas`** — cluster por `y` com tolerância 0.02; concatenar `str`; calcular bbox união normalizada.

- [ ] **1.4 Implementar `localizarLinhaPdf`** — normalizar valor/data; varrer páginas em ordem; primeiro match global; desempate por overlap de tokens (usar `stripDocumentsFromDescricao` se exportado em browser/core).

- [ ] **1.5 Export** — `export { localizarLinhaPdf, ... } from "./pdf-locate/localizar-linha-pdf"` em `packages/core/src/index.ts`.

- [ ] **1.6 Verificar:** `pnpm --filter @spc-up/core test pdf-locate`

### Critérios de aceite

- [ ] Todos os testes passam sem rede/PDF real
- [ ] Função não importa pdf.js (só dados normalizados)
- [ ] Tipos exportados no pacote core

---

## Subagent 2 — UI: `PdfOrigemPainel` + hook text layer

**Dependências:** nenhuma  
**Paralelo com:** Subagent 1

### Objetivo

Componente reutilizável para **um** PDF: render canvas, highlight (amarelo extração / azul tracejado estimado), navegação ‹ ›, botão **Voltar à origem**, legenda de fonte do highlight.

### Arquivos

- Create: `apps/web/hooks/use-pdf-text-layer.ts`
- Create: `apps/web/components/prestacao/pdf-origem-painel.tsx`

### Passos

- [ ] **2.1 Hook `usePdfTextLayer`** — dado `arquivoIngestaoId`, carrega PDF via fetch existente (`/api/arquivos-ingestao/:id/pdf`), extrai por página itens `{ str, x, y, width, height }` normalizados 0–1 (mesma escala do canvas). Retorna `{ paginas, pageCount, loading, error }`.

- [ ] **2.2 Props do painel:**

```typescript
type HighlightMode = "extracao" | "estimada" | "none";

type PdfOrigemPainelProps = {
  arquivoIngestaoId: string;
  nomeArquivo: string;
  papel?: string;
  paginaInicial: number;
  bbox?: BboxNorm;
  highlightMode: HighlightMode;
  indiceLinha?: number;
  dataMovimento: string;
  valor: string;
  descricaoRaw: string;
  onHeuristica?: (result: LocalizarLinhaPdfResult) => void;
};
```

- [ ] **2.3 Render** — extrair lógica de `pdf-origem-viewer.tsx` (canvas + overlay bbox). Estados: `paginaAtual`, `paginaOrigem`, `bboxAtual`, `highlightModeAtual`.

- [ ] **2.4 Sem `bbox` inicial** — após text layer pronto, chamar `localizarLinhaPdf` do core; se match → `highlightMode: "estimada"`, atualizar `paginaOrigem`/`bboxAtual`; senão legenda "Não localizado no PDF".

- [ ] **2.5 Navegação** — ‹ › desabilitados nos limites; highlight visível só quando `paginaAtual === paginaOrigem`; **Voltar à origem** restaura `paginaOrigem`.

- [ ] **2.6 Estilos** — amarelo `border-amber-500 bg-amber-400/20`; azul tracejado `border-blue-500 border-dashed bg-blue-400/15`; legenda abaixo do canvas.

- [ ] **2.7 Verificar manual:** renderizar painel isolado em story ou página dev temporária (opcional); pelo menos `pnpm --filter web exec tsc --noEmit` sem erros no arquivo novo.

### Critérios de aceite

- [ ] Painel renderiza PDF e highlight amarelo com bbox passado
- [ ] Heurística acionada quando bbox ausente
- [ ] Navegação e Voltar à origem funcionam
- [ ] Sem dependência do modal (componente puro)

---

## Subagent 3 — UI: `PdfComparadorModal`

**Dependências:** Subagent 1 ✅, Subagent 2 ✅

### Objetivo

Modal fullscreen com cabeçalho de contexto, grid 2 colunas (1 col mobile), dois `PdfOrigemPainel` (PIX esquerda, COMPLETO direita), rodapé com ações merge.

### Arquivos

- Create: `apps/web/components/prestacao/pdf-comparador-modal.tsx`
- Create: `apps/web/lib/pdf-comparador-origens.ts` — `selecionarOrigensPixCompleto(origens: PlanilhaOrigem[])`

### Passos

- [ ] **3.1 Helper origens** — filtrar `papel === "PIX"` e `papel === "COMPLETO"`; primeiro de cada; retornar `{ pix, completo }` com null se ausente.

- [ ] **3.2 Props modal:**

```typescript
type PdfComparadorModalProps = {
  open: boolean;
  onClose: () => void;
  linha: PlanilhaLinha;
  sessaoId: string;
  onMergeResolved: () => void;
};
```

- [ ] **3.3 Cabeçalho** — data, valor, direção, badge confiança (reutilizar `confiancaTone` de planilha), PF/PJ, duas linhas `descricaoRaw` (PIX / COMPLETO).

- [ ] **3.4 Layout** — `fixed inset-0 z-50`; `grid md:grid-cols-2 grid-cols-1`; max height painéis `calc(100vh - header - footer)`.

- [ ] **3.5 Painéis** — mapear cada origem para `PdfOrigemPainel`; lado vazio → placeholder "Origem não disponível"; passar `origemExtracao?.bbox` e `pagina` quando existir.

- [ ] **3.6 Rodapé merge** — se `linha.status === "merge_pendente"`: botões Confirmar merge / Manter separado; senão só Fechar. Confirmar → `POST /api/prestacao/sessoes/${sessaoId}/planilha/linhas/${linha.id}/merge` body `{ acao, fonte: linha.fonte }`.

- [ ] **3.7 Dialog separar** — estado `confirmSeparar`; mensagem "Isso criará 2 linhas separadas. Continuar?"; Cancelar fecha dialog; Confirmar chama API.

- [ ] **3.8 Acessibilidade** — Esc fecha modal (sem ação merge); foco trap básico no modal.

- [ ] **3.9 Verificar:** `pnpm --filter web exec tsc --noEmit`

### Critérios de aceite

- [ ] Modal abre com 2 painéis PIX|COMPLETO
- [ ] Cabeçalho exibe contexto da spec §4.2
- [ ] Merge confirmar/separar chama API correta
- [ ] Dialog inline antes de separar
- [ ] Layout empilhado em viewport estreito

---

## Subagent 4 — Integração planilha + dados API

**Dependências:** Subagent 3 ✅

### Objetivo

Botão **Comparar PDFs** na planilha; `PlanilhaOrigem` carrega `origemExtracao` para evitar fetch extra; wire modal + refresh.

### Arquivos

- Modify: `packages/core/src/planilha/types.ts`
- Modify: `packages/core/src/planilha/list.ts`
- Modify: `packages/core/src/planilha/list.test.ts`
- Modify: `apps/web/components/prestacao/planilha-table.tsx`

### Passos

- [ ] **4.1 Estender `PlanilhaOrigem`:**

```typescript
import type { OrigemExtracaoV1 } from "../provenance/..."; // path real do tipo

export type PlanilhaOrigem = {
  // ...campos existentes
  origemExtracao?: OrigemExtracaoV1 | null;
  indiceLinha?: number;
  bbox?: BboxNorm;
};
```

- [ ] **4.2 `origensFromLinhas`** — copiar `origemExtracao`, `indiceLinha`, `bbox` de cada linha consolidada; para movimentação única, idem de `mov.origemExtracao`.

- [ ] **4.3 Teste list** — fixture com 2 linhas consolidadas assert `origens[0].origemExtracao.pagina` etc.

- [ ] **4.4 Estado em `planilha-table.tsx`:**

```typescript
const [comparadorLinha, setComparadorLinha] = useState<PlanilhaLinha | null>(null);
```

- [ ] **4.5 Botão Ações** — quando `linha.origens.length >= 2`, renderizar **Comparar PDFs** (primário); manter **Ver PDF** na lista expandida.

- [ ] **4.6 Render modal** — `<PdfComparadorModal open={!!comparadorLinha} linha={comparadorLinha!} ... onMergeResolved={() => void refresh()} />`

- [ ] **4.7 Verificar:** `pnpm --filter @spc-up/core test planilha/list` + smoke manual na planilha com sessão ≥2 PDFs.

### Critérios de aceite

- [ ] GET planilha retorna `origemExtracao` por origem
- [ ] Botão visível só com ≥2 origens
- [ ] Modal abre com linha correta
- [ ] Após merge, planilha atualiza sem reload completo

---

## Subagent 5 — Refactor viewer + ConsolidacaoPlanilha

**Dependências:** Subagent 2 ✅, Subagent 3 ✅  
**Pode iniciar:** em paralelo com Subagent 4 após 3 pronto

### Objetivo

DRY: `PdfOrigemViewer` delega a `PdfOrigemPainel`; `ConsolidacaoPlanilha` ganha **Comparar PDFs** no evento expandido reutilizando `PdfComparadorModal` (adapter mínimo de `ConsolidacaoEventoRow` → `PlanilhaLinha`).

### Arquivos

- Modify: `apps/web/components/prestacao/pdf-origem-viewer.tsx`
- Modify: `apps/web/components/prestacao/consolidacao-planilha.tsx`
- Create (se necessário): `apps/web/lib/planilha-linha-from-evento.ts`

### Passos

- [ ] **5.1 Refactor `PdfOrigemViewer`** — modal wrapper fino: header com nomeArquivo + Fechar; body = `<PdfOrigemPainel highlightMode={bbox ? "extracao" : "none"} ... />`. Remover duplicação canvas/highlight.

- [ ] **5.2 Adapter evento → linha** — função pura que monta `PlanilhaLinha` mínima a partir de `ConsolidacaoEventoRow` (id, status, origens com origemExtracao das linhas, data/valor/direção/confiança/pessoa).

- [ ] **5.3 `ConsolidacaoPlanilha`** — na linha resumo do evento (sanfona aberta ou fechada), botão **Comparar PDFs** quando `evento.linhas.length >= 2`; abre mesmo modal; `onMergeResolved` opcional (noop se rota legada sem API merge).

- [ ] **5.4 Regressão** — fluxos existentes "Ver" single PDF continuam funcionando em planilha e consolidacao-planilha.

- [ ] **5.5 Verificar:** `pnpm --filter web exec tsc --noEmit`; testes core intactos.

### Critérios de aceite

- [ ] `PdfOrigemViewer` usa `PdfOrigemPainel` internamente
- [ ] Sem regressão visual no viewer single-PDF
- [ ] ConsolidacaoPlanilha abre comparador (se mantida na rota)

---

## Verificação final (agente coordenador)

Após os 5 subagentes:

- [ ] `pnpm --filter @spc-up/core test`
- [ ] `pnpm --filter web exec tsc --noEmit`
- [ ] Smoke manual: sessão com PIX+COMPLETO → Comparar PDFs → highlights → merge pendente → confirmar
- [ ] Smoke: upload legado sem bbox → highlight azul estimado ou "Não localizado"
- [ ] Viewport mobile: painéis empilhados

---

## Notas para subagentes

1. **Não criar rotas API novas** — spec §8.
2. **Rota PDF:** `/api/arquivos-ingestao/${arquivoIngestaoId}/pdf` (ver `pdf-origem-viewer.tsx`).
3. **Papel PIX/COMPLETO** — constantes em `packages/core/src/consolidacao/types.ts` se existirem; não inventar novos valores.
4. **YAGNI v1** — não implementar highlight por campo, scroll sync, seletor 3+ origens.
5. **Commits** — um commit por subagente concluído, mensagem Conventional Commits referenciando spec.
