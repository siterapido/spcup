# Planilha unificada — consolidação e PF/PJ (Design)

**Data:** 2026-06-07  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado (2026-06-07)  
**Relacionado:**
- [2026-05-25-spc-up-prestacao-contas-design.md](./2026-05-25-spc-up-prestacao-contas-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)
- [2026-05-26-fluxo-prestacao-contas-design.md](./2026-05-26-fluxo-prestacao-contas-design.md)

---

## 1. Resumo executivo

Simplificar o fluxo web de prestação de contas substituindo o pipeline fragmentado (wizard 6 passos, `/consolidacao`, `/movimentacoes` + `ReviewDrawer`) por **uma planilha única** como tela principal de trabalho.

**Objetivo:** consolidar extratos bancários (dedup cross-PDF quando aplicável) e identificar PF/PJ de cada movimentação para exportação XML SPCA.

**Abordagem escolhida:** Planilha central em `/prestacao/[id]/planilha`, com upload enxuto, merge automático PIX↔extrato completo, PF/PJ inline + correção em lote, e export bloqueado até 100% das linhas prontas.

**Implementação em duas fases:**
- **Fase 1:** API e UI em cima de `consolidacao_evento` existente (sem migration de schema).
- **Fase 2:** Unificar modelo em `movimentacao` canônica; deprecar tabelas `consolidacao_*`.

---

## 2. Problema atual

| Sintoma | Causa |
|---------|-------|
| Operador não sabe onde revisar | Duas telas (`/consolidacao` e `/movimentacoes`) com papéis sobrepostos |
| Muito clique para PF/PJ | `ReviewDrawer` obrigatório; aprovação de eventos em lote separada |
| Wizard longo | 6 passos incluindo mapeamento de colunas como etapa fixa |
| Checkbox "Consolidar extratos" | Bifurca fluxo sem ganho claro para o operador |
| `consolidacao-table.tsx` ~1300 linhas | UI acumulou hipóteses, conflitos, planilha CSV, origens — difícil de manter |

O core (`consolidateSession`, match cadastro, ingest PDF) funciona; o gargalo é **produto e apresentação**, não o motor de cruzamento.

---

## 3. Decisões de produto

| Tema | Decisão |
|------|---------|
| Tela principal | `/prestacao/[id]/planilha` — única UI de revisão pós-upload |
| Objetivo do operador | PF/PJ em cada linha; consolidação é mecanismo invisível |
| Dedup cross-PDF | Merge automático; badge "N origens" expansível |
| Merge ambíguo | Linha com status "merge pendente"; ações Confirmar merge / Manter separado |
| PF/PJ | Sugestão automática + célula editável (autocomplete cadastro UF) |
| Correção em lote | Selecionar linhas → "Aplicar pessoa" |
| PDF | Viewer lateral sob demanda ("Ver PDF"); não drawer obrigatório |
| Upload | 1 tela: UF + Estadual/Municipal + exercício + arquivos |
| Consolidação opt-in | Removida da UI; `consolidarExtratos=true` automático se ≥2 PDFs na sessão |
| Mapeamento colunas | Modal apenas se extração falhar (não passo fixo do wizard) |
| Páginas "verificar" | Badge "extração duvidosa" na planilha; não interrompe ingest |
| Cadastro vazio | Banner + link `/pessoas/importar`; upload e planilha funcionam |
| Confiança alta | ≥0,85 — verde, pronta |
| Confiança média | 0,60–0,84 — amarelo, pronta sem clique extra |
| Confiança baixa | &lt;0,60 — vermelho, bloqueia export |
| Limiar export | 0,60 fixo (via `CONFIANCA_LIMIAR_BAIXA`) |
| Export | Botão na barra da planilha; destino `/prestacao/[id]/export` quando 100% prontas |
| Rotas antigas | `/consolidacao`, `/movimentacoes`, `/kanban` → redirect `/planilha` |
| CLI Fase 1 | Sem mudança obrigatória |
| Cadastro no upload | Fase 2 (drag `pessoas.xlsx` junto com PDFs) |

---

## 4. Fluxo do operador

```
/prestacao/nova
  → UF | toggle Estadual/Municipal | dropdown município (se municipal) | exercício | PDFs
  → processar em background
  → redirect /prestacao/:id/planilha

/prestacao/:id/planilha
  → revisar PF/PJ, resolver merge pendente, usar filtros
  → barra "900/900 prontas" habilita Exportar
  → /prestacao/:id/export (validação XSD + download)

/pessoas/importar
  → cadastro UF (recomendado antes do export; não obrigatório para upload)
```

Pipeline visual simplificado: **Upload → Planilha → Export** (substitui `END_TO_END_FLOW_STEPS` de 8 passos na comunicação ao operador).

---

## 5. Planilha — UX

### 5.1 Colunas

| Coluna | Editável | Notas |
|--------|----------|-------|
| Data | Não | Canônica pós-merge |
| Valor | Não | |
| Direção | Não | ENTRADA / SAIDA |
| Descrição | Não | Texto limpo (`cleanTransactionName`) |
| PF/PJ | Sim | Autocomplete cadastro UF; exibe nome + documento mascarado |
| Confiança | Não | Ícone/cor por faixa |
| Origens | Não | Badge "N origens"; expandir lista PDF/página/descrição raw |
| Status | Não | Pronta / pendente / merge pendente / extração duvidosa |

### 5.2 Barra fixa (toolbar)

- Contador: `{prontas}/{total} prontas para export`
- Filtros rápidos: sem pessoa · baixa confiança · merge pendente · extração duvidosa
- Banner cadastro vazio (se UF sem pessoas): link para `/pessoas/importar`
- Botão **Exportar XML**: habilitado só com 100% prontas; senão scroll para primeira linha pendente

### 5.3 Ações por linha

- **Ver PDF** — painel lateral com `pdf-origem-viewer` (highlight da linha)
- **Confirmar merge** — quando status = merge pendente
- **Manter separado** — desfaz merge sugerido; exibe 2 linhas

### 5.4 Ações em lote

- Selecionar checkbox em N linhas → **Aplicar pessoa** (mesmo PF/PJ)

### 5.5 Critério "linha pronta"

Uma linha conta como pronta quando **todas** as condições são verdadeiras:

1. `pessoaFisicaId` ou `pessoaJuridicaId` preenchido
2. `confianca >= 0.60`
3. Status ≠ `merge pendente`
4. Status ≠ `extracao_duvidosa` (permanece pendente até reprocessamento da página ou confirmação explícita — ver §7.3)

---

## 6. Arquitetura

### 6.1 Diagrama

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Wizard compacto │────▶│ processSessao    │────▶│ consolidateSession  │
│ + upload PDFs   │     │ (ingest por pág.)│     │ (se ≥2 PDFs)        │
└─────────────────┘     └──────────────────┘     └──────────┬──────────┘
                                                            │
┌─────────────────┐     ┌──────────────────┐                │
│ /planilha UI    │◀────│ GET /planilha    │◀───────────────┘
│ planilha-table  │     │ adapter linhas   │     consolidacao_evento
└────────┬────────┘     └──────────────────┘     ou movimentacao (1 PDF)
         │
         │ PATCH pessoa / POST lote / POST merge
         ▼
┌─────────────────┐     ┌──────────────────┐
│ approve /       │────▶│ movimentacao     │
│ update mov      │     │ canônica (Fase 2)│
└─────────────────┘     └──────────────────┘
```

### 6.2 API Fase 1 (nova)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/prestacao/sessoes/:id/planilha` | Linhas flat + resumo contadores |
| PATCH | `/api/prestacao/sessoes/:id/planilha/linhas/:linhaId` | Atualizar PF/PJ |
| POST | `/api/prestacao/sessoes/:id/planilha/lote` | Aplicar pessoa em N linhas |
| POST | `/api/prestacao/sessoes/:id/planilha/linhas/:linhaId/merge` | `{ acao: "confirmar" \| "separar" }` |

**Resposta `GET /planilha`:**

```typescript
type PlanilhaLinha = {
  id: string;                    // consolidacao_evento.id ou movimentacao.id
  fonte: "consolidacao" | "movimentacao";
  dataMovimento: string;
  valor: string;
  direcao: string;
  descricao: string;
  confianca: number;
  status: "pronta" | "pendente" | "merge_pendente" | "extracao_duvidosa";
  pessoa: { id: string; tipo: "PF" | "PJ"; nome: string; documento: string } | null;
  origens: Array<{
    movimentacaoId: string;
    nomeArquivo: string | null;
    pagina?: number;
    descricaoRaw: string;
    papel?: string;
  }>;
};

type PlanilhaResumo = {
  total: number;
  prontas: number;
  semPessoa: number;
  baixaConfianca: number;
  mergePendente: number;
  extracaoDuvidosa: number;
  cadastroAlerta: boolean;
  exportavel: boolean;
};
```

### 6.3 Adapter de linhas

| Condição | Fonte | `fonte` |
|----------|-------|---------|
| ≥2 PDFs e `consolidacao_evento` existentes | `listConsolidacaoForSessao` | `consolidacao` |
| 1 PDF ou consolidação não rodou | `getKanbanPayload` flat | `movimentacao` |

Mapeamento de escrita:
- `fonte=consolidacao` → reutilizar `approveConsolidacaoEvento`, endpoints de rejeitar/separar existentes
- `fonte=movimentacao` → reutilizar PATCH em `/api/movimentacoes/:id` ou equivalente core

### 6.4 Componentes web

| Novo | Substitui / complementa |
|------|-------------------------|
| `app/prestacao/[sessaoId]/planilha/page.tsx` | `/consolidacao`, `/kanban` |
| `components/prestacao/planilha-table.tsx` | `consolidacao-table.tsx` |
| `components/prestacao/planilha-toolbar.tsx` | header + filtros de consolidação |
| Wizard compacto em `wizard.tsx` | 6 passos → 1 tela |

**Manter sem mudança estrutural:** `pdf-origem-viewer`, `use-prestacao-submit` (ajustar redirect), `/export`, ingest core.

### 6.5 Core (`@spc-up/core`)

Fase 1: novo módulo `packages/core/src/planilha/` com:

- `listPlanilhaForSessao(db, sessaoId)` — adapter unificado
- `updatePlanilhaLinhaPessoa(db, linhaId, fonte, pessoa)`
- `applyPlanilhaLote(db, sessaoId, ids, pessoa)`
- `resolvePlanilhaMerge(db, linhaId, acao)`

Reuso direto: `listConsolidacaoForSessao`, `consolidateSession`, `approveConsolidacaoEvento`, thresholds em `consolidacao/thresholds.ts`.

---

## 7. Regras de negócio

### 7.1 Merge cross-PDF

Reutilizar `consolidacao/candidates.ts` e `consolidateSession` sem alterar scores de regras (ex.: 0,90 CPF completo, 0,80 nome cadastro, 0,65 par nome-only).

**Exibição na planilha:**

| Condição | Status na planilha |
|----------|-------------------|
| Evento com ≥2 linhas (cross-PDF) e `consolidacao_evento.status = PENDENTE` | `merge_pendente` — bloqueia export da linha até Confirmar merge ou Manter separado |
| Evento com ≥2 linhas e `status = APROVADO` (auto ou manual) | `pronta` ou `pendente` conforme PF/PJ e confiança |
| Movimentação sem par (1 linha no evento) | Sem merge; status derivado só de PF/PJ e confiança |

**Confirmar merge** chama `approveConsolidacaoEvento` existente. **Manter separado** rejeita o evento e expõe movimentações como linhas `fonte=movimentacao` separadas.

### 7.2 PF/PJ — ordem de match

1. CPF/CNPJ na descrição do extrato
2. Nome único no cadastro UF (`NOME_CADASTRO`)
3. Par PIX↔completo (enriquecimento cross-PDF)
4. IA (OpenRouter/NotebookLM) para ambíguos — cap de confiança existente

### 7.3 Extração duvidosa

Movimentações/páginas com `statusPagina=VERIFICAR` ou `confiancaGlobal` muito baixa na origem → linha com status `extracao_duvidosa`. Operador pode:
- Corrigir PF/PJ manualmente (se extração do valor/data estiver aceitável), ou
- Reprocessar página via fluxo existente de verificação (modal, não passo do wizard)

### 7.4 `consolidarExtratos` no banco

- UI remove checkbox
- Ao criar sessão: `consolidarExtratos = (pdfCount >= 2)` após upload, ou `true` se upload inclui ≥2 PDFs
- Campo mantido no schema para compatibilidade e CLI

---

## 8. Rotas e redirects

| Rota | Fase 1 |
|------|--------|
| `/prestacao/nova` | Wizard compacto |
| `/prestacao/[id]/planilha` | **Nova** — tela principal |
| `/prestacao/[id]/export` | Mantida; gate na planilha |
| `/prestacao/[id]/consolidacao` | 302 → `/planilha` |
| `/prestacao/[id]/movimentacoes` | 302 → `/planilha` |
| `/prestacao/[id]/kanban` | 302 → `/planilha` |

Lista de sessões (`sessoes-list.tsx`): link principal → `/planilha`; remover badge distinto "consolidar".

---

## 9. Fase 2 (backlog)

| Item | Descrição |
|------|-----------|
| Schema unificado | `movimentacao` canônica + `movimentacao_origem`; deprecar `consolidacao_evento`, `consolidacao_linha`, `consolidacao_hipotese` |
| Cadastro no upload | Drag-and-drop `pessoas.xlsx` na tela de upload |
| CLI | Métricas alinhadas à barra da planilha (`prontas/total`) |
| Limiar por sessão | Configurável se operação nacional pedir |

---

## 10. Testes de aceite (Fase 1)

| # | Cenário | Resultado esperado |
|---|---------|-------------------|
| 1 | Upload Bahia PIX + extrato completo | 1 linha por transação cruzada; 2 origens expansíveis |
| 2 | Upload 1 PDF | Planilha com 1 linha por `movimentacao`; sem erro |
| 3 | PF/PJ inline | Autocomplete cadastro; persistência após refresh |
| 4 | Lote "Aplicar pessoa" | N linhas atualizadas |
| 5 | Merge ambíguo | Status merge pendente; Confirmar/Separar funciona |
| 6 | Export bloqueado | &lt;100% prontas → botão desabilitado |
| 7 | Export liberado | 100% prontas → `/export` gera XML |
| 8 | Redirects | URLs antigas abrem `/planilha` |
| 9 | Cadastro vazio | Banner visível; planilha carrega |
| 10 | Regressão core | `consolidateSession` e fixtures Bahia passam |

**Fixtures:** `Documentos para teste /Extrato Jan PIX (1).pdf`, `EXTRATO TOTAL JANEIRO (1) (1).pdf`, `pessoas bahia (1).xlsx`.

---

## 11. Fora de escopo (Fase 1)

- Edição inline de data/valor/descrição
- Deprecação física de tabelas `consolidacao_*`
- Import cadastro no upload
- Mudanças no CLI além de compatibilidade
- Fuzzy match de nomes (permanece backlog P2 do design original)
- OFX/CSV cross-file (fase 2 do design de consolidação original)

---

## 12. Abordagens consideradas

| # | Abordagem | Motivo descarte |
|---|-----------|-----------------|
| 1 | **Planilha única** (escolhida) | — |
| 2 | Evoluir `/movimentacoes` in-place | Herda complexidade e modelo "por arquivo" |
| 3 | Consolidação headless | Sem controle de merge ambíguo; duas telas de revisão persistem |
