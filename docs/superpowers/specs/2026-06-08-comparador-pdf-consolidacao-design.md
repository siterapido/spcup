# Comparador PDF lado a lado na planilha — Design

**Data:** 2026-06-08  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (grill-me 2026-06-08)  
**Relacionado:**
- [2026-05-27-consolidacao-proveniencia-pdf-design.md](./2026-05-27-consolidacao-proveniencia-pdf-design.md)
- [2026-06-07-planilha-unificada-design.md](./2026-06-07-planilha-unificada-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)

---

## 1. Resumo

Operador revisa consolidação na **planilha unificada** abrindo **dois PDFs lado a lado** (PIX à esquerda, COMPLETO à direita), com a **linha de cada transação destacada** no trecho de onde a informação foi extraída — ou **localização estimada** por heurística quando proveniência não existe.

**Objetivo:** auditoria humana do cruzamento PIX↔extrato completo sem alternar modais PDF um a um.

---

## 2. Decisões de produto (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Gatilho | Qualquer linha com ≥2 origens PDF |
| 2 | Layout | Modal fullscreen; 50/50 em desktop |
| 3 | Highlight | Linha inteira (`bbox` de `origemExtracao` quando existir) |
| 4 | Ações merge | Rodapé: Confirmar merge / Manter separado quando `merge_pendente`; demais linhas só Fechar |
| 5 | Ordem painéis | PIX esquerda, COMPLETO direita; cabeçalho com papel + nomeArquivo |
| 6 | 3+ origens | Modal mostra só PIX + COMPLETO; extras permanecem na lista "N origens" |
| 7 | Abertura | Botão **Comparar PDFs** na coluna Ações; **Ver PDF** individual mantido na lista expandida |
| 8 | Sem proveniência | Heurística no text layer do PDF |
| 9 | Heurística | Prioriza **valor + data**; `descricaoRaw` só desempata |
| 10 | Busca heurística | Varre **todas** as páginas; exige valor **e** data no **mesmo trecho** de texto |
| 11 | Cabeçalho modal | Data, valor, direção, confiança %, PF/PJ, `descricaoRaw` PIX e COMPLETO |
| 12 | Manter separado | Dialog inline de confirmação antes de executar |
| 13 | Navegação | ‹ › por painel + botão "Voltar à origem" |
| 14 | Cores highlight | Amarelo = extração (`origemExtracao`); azul tracejado = estimado (heurística) |
| 15 | Escopo código | Heurística em `packages/core` (testável); UI na planilha; `ConsolidacaoPlanilha` reutiliza depois |
| 16 | Mobile | &lt;768px: painéis empilhados (PIX em cima, COMPLETO embaixo) |

---

## 3. Estado atual (gap)

| Hoje | Falta |
|------|-------|
| `PdfOrigemViewer` — um PDF por modal | Dois painéis simultâneos |
| Planilha: "Ver PDF" por origem, um de cada vez | **Comparar PDFs** na linha |
| `origemExtracao` com `pagina`, `indiceLinha`, `bbox?` | Heurística quando `null` |
| Ações merge só na tabela | Merge no rodapé do comparador |
| Highlight amarelo único | Distinção visual proveniência vs estimado |

---

## 4. UX

### 4.1 Gatilho na planilha

- Linha com `origens.length >= 2` → botão primário **Comparar PDFs** na coluna Ações.
- Lista expandida "N origens" mantém **Ver PDF** individual (fallback, 3ª origem, etc.).

### 4.2 Modal fullscreen

```
┌─────────────────────────────────────────────────────────────────┐
│ Data · Valor · Direção · [Confiança%] · PF/PJ                   │
│ PIX: <descricaoRaw>          COMPLETO: <descricaoRaw>           │
├────────────────────────────┬────────────────────────────────────┤
│ PIX · extrato-pix.pdf      │ COMPLETO · extrato-full.pdf        │
│ ‹ pág 3 de 12 › [Origem]   │ ‹ pág 5 de 20 › [Origem]          │
│ ┌────────────────────────┐ │ ┌────────────────────────┐         │
│ │ PDF + highlight        │ │ PDF + highlight        │         │
│ └────────────────────────┘ │ └────────────────────────┘         │
│ extração / estimado        │ extração / estimado                │
├────────────────────────────┴────────────────────────────────────┤
│ [Confirmar merge] [Manter separado]              [Fechar]       │  ← merge_pendente
│                                              [Fechar]           │  ← demais status
└─────────────────────────────────────────────────────────────────┘
```

- Desktop: `grid-cols-2`.
- Mobile (`<md`): `grid-cols-1`, PIX primeiro.

### 4.3 Highlight

| Fonte | Cor | Legenda no painel |
|-------|-----|-------------------|
| `origemExtracao.bbox` válido | `border-amber-500 bg-amber-400/20` | "Extração" |
| Heurística | `border-blue-500 border-dashed bg-blue-400/15` | "Localização estimada" |
| Sem match | Sem retângulo | "Não localizado no PDF" |

### 4.4 Navegação por painel

- Abre na página de `origemExtracao.pagina` ou página encontrada pela heurística.
- ‹ › altera página; highlight oculto fora da página de origem.
- **Voltar à origem** restaura página + highlight.

### 4.5 Ações merge (`status === merge_pendente`)

- **Confirmar merge** → `POST .../merge { acao: "confirmar" }` → fecha modal → refresh planilha.
- **Manter separado** → dialog "Isso criará 2 linhas separadas. Continuar?" → `POST .../merge { acao: "separar" }`.

---

## 5. Heurística de localização (`packages/core`)

### 5.1 Entrada

```ts
type LocalizarLinhaPdfInput = {
  paginas: Array<{ pagina: number; itens: TextItem[] }>;
  dataMovimento: string; // YYYY-MM-DD
  valor: string;         // ex. "1500.00"
  descricaoRaw: string;
};

type TextItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
```

Coordenadas normalizadas 0–1 relativas à página.

### 5.2 Algoritmo

1. Normalizar `valor` para formatos BR (`1.500,00`, `1500.00`, `R$ 1.500,00`).
2. Normalizar `dataMovimento` (`DD/MM/YYYY`, `DD/MM/YY`).
3. Para cada página em ordem:
   - Agrupar `TextItem` em linhas por proximidade vertical (~2% altura).
   - Match se linha contém **valor** E **data**.
   - Desempate: maior overlap de tokens de `descricaoRaw` (sem CPF/CNPJ).
4. Primeiro match global vence.
5. `bbox` = união dos itens da linha matched.

### 5.3 Saída

```ts
type LocalizarLinhaPdfResult =
  | { encontrado: true; pagina: number; bbox: BboxNorm; confianca: "estimada" }
  | { encontrado: false; motivo: string };
```

### 5.4 Testes obrigatórios

- Valor+data na mesma linha → match.
- Valor e data em linhas diferentes → sem match.
- Múltiplos valores iguais → desempate `descricaoRaw`.
- Formatos BR valor/data.
- Match em página 2+.

---

## 6. Componentes web

| Componente | Responsabilidade |
|------------|------------------|
| `pdf-origem-painel.tsx` | Um PDF: canvas, highlight, navegação, legenda |
| `pdf-comparador-modal.tsx` | Modal fullscreen, cabeçalho, 2 painéis, rodapé merge |
| `use-pdf-text-layer.ts` | Text items por página via pdf.js (browser) |
| `planilha-table.tsx` | Botão Comparar PDFs, wire modal, merge API |

**Reuso:** extrair render de `pdf-origem-viewer.tsx` → `pdf-origem-painel.tsx`; viewer single-PDF delega ao painel.

---

## 7. Seleção de origens no modal

1. Filtrar `origens` por `papel === "PIX"` e `papel === "COMPLETO"`.
2. Múltiplos do mesmo papel: primeiro da lista API.
3. Papel ausente: placeholder no lado vazio.
4. ≥3 origens: extras só na planilha.

---

## 8. API

Sem rotas novas. Reutiliza:

- `GET /api/movimentacoes/:id` — `origemExtracao` lazy
- Rota PDF existente do `PdfOrigemViewer`
- `POST /api/prestacao/sessoes/:id/planilha/linhas/:linhaId/merge`

Garantir `origens[]` em `GET /planilha` com dados suficientes para o comparador.

---

## 9. Fora de escopo (v1)

- Highlight por campo (`campos` em `origemExtracao`)
- Comparador em `ConsolidacaoPlanilha` (reuso do componente depois)
- Reprocessar PDFs legados em massa
- Scroll sincronizado entre painéis
- Seletor para 3+ origens no modal

---

## 10. Critérios de aceite

1. Linha com 2+ origens exibe **Comparar PDFs**.
2. Modal abre PIX | COMPLETO com highlights quando `origemExtracao.bbox` existe.
3. Sem proveniência, heurística encontra linha com valor+data ou mostra "Não localizado".
4. Cores e legendas distinguem extração vs estimado.
5. Navegação ‹ › e Voltar à origem por painel.
6. `merge_pendente`: confirmar/separar no rodapé com confirmação em separar.
7. Mobile: painéis empilhados.
8. Testes unitários da heurística em `packages/core`.
