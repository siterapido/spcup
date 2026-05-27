# Proveniência PDF na consolidação e kanban — Design

**Data:** 2026-05-27  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (brainstorming 2026-05-27)  
**Relacionado:**
- `2026-05-26-consolidacao-extratos-design.md`
- `2026-05-26-pdf-extrato-prestacao-design.md`
- `2026-05-26-documentos-teste-ingestao-descobertas.md`

---

## 1. Resumo

Operador precisa saber **de onde veio cada informação** usada na consolidação de extratos e, depois da aprovação, no kanban: **qual PDF**, **página**, **índice da linha** na tabela extraída, com **destaque visual** no documento. Atributos vindos do **cadastro da UF** ou de **regras de cruzamento** (PIX↔completo) têm origem explícita separada, sem coordenada no PDF.

**Decisões de escopo (brainstorming):**

| Tema | Decisão |
|------|---------|
| Local no PDF | Página + índice de linha + highlight visual (bbox) |
| Onde exibir | Tela de consolidação e kanban/detalhe da movimentação |
| Captura de posição | Schema da IA na extração + `pagina` fixada pelo batch de ingestão |
| Granularidade | Por atributo do evento consolidado e da movimentação |
| Dados legados | Apenas novos uploads; `null` → “origem indisponível” (sem reprocessar) |

**Objetivo:** auditoria humana — não merge silencioso, rastreio clicável até o trecho do extrato.

---

## 2. Estado atual (gap)

| Hoje | Falta |
|------|-------|
| `consolidacao_linha` → `arquivo_ingestao` + `papel` (PIX/COMPLETO) | Página, linha, bbox |
| UI: `nomeArquivo` + `descricao_raw` | Viewer PDF com highlight |
| `movimentacao.arquivo_ingestao_id` | `origem_extracao` estruturada |
| `match_evidencia` (tipo + detalhe texto) | Mapa por atributo no evento consolidado |
| Ingest multipágina em lotes | Índice de página perdido no merge de transações |

---

## 3. Abordagem escolhida

**Proveniência em JSONB** na ingestão (`movimentacao`) e no evento (`consolidacao_evento`), com viewer pdf.js na UI.

Alternativas consideradas e descartadas:

- **Tabela relacional `proveniencia_registro`:** melhor para relatórios massivos; rejeitada na v1 por custo de implementação.
- **Proveniência só em `consolidacao_evento`:** não atende kanban pós-aprovação.

---

## 4. Modelo de dados

### 4.1 `movimentacao.origem_extracao` (jsonb, nullable)

Preenchido em `ingestPdfExtrato` para uploads após deploy. Legado permanece `null`.

```ts
type OrigemExtracaoV1 = {
  versao: 1;
  arquivoIngestaoId: string;
  nomeArquivo: string;
  pagina: number; // 1-based
  indiceLinha: number; // 1-based na página
  bbox?: BboxNorm; // opcional, 0–1 relativo à página
  campos?: Partial<Record<CampoExtrato, CampoOrigem>>;
};

type BboxNorm = { x: number; y: number; w: number; h: number };

type CampoExtrato =
  | "data"
  | "valor"
  | "direcao"
  | "cpf"
  | "cnpj"
  | "nome"
  | "descricao";

type CampoOrigem = {
  pagina: number;
  indiceLinha: number;
  bbox?: BboxNorm;
};
```

**Regras de validação na persistência:**

- `pagina` ∈ [1, `pageCount` do arquivo]
- `indiceLinha` ≥ 1
- `bbox`: cada componente ∈ [0, 1]; se inválido, omitir `bbox` (não falhar ingestão)
- `versao` permite evolução futura do schema sem migração destrutiva

### 4.2 `consolidacao_evento.origem_atributos` (jsonb, nullable)

Montado em `consolidateSession` / `persistConsolidacaoDrafts`. Mapa de atributos canônicos do evento para lista ordenada de origens.

```ts
type OrigemAtributosEvento = {
  versao: 1;
  dataMovimento: OrigemRef[];
  valor: OrigemRef[];
  direcao: OrigemRef[];
  pessoa: OrigemRef[];
  confianca: OrigemRef[];
};

type OrigemRef =
  | {
      tipo: "PDF";
      movimentacaoId: string;
      arquivoIngestaoId: string;
      nomeArquivo: string;
      pagina: number;
      indiceLinha: number;
      bbox?: BboxNorm;
      campo: CampoExtrato | "linha_inteira";
    }
  | {
      tipo: "CADASTRO_UF";
      pessoaFisicaId?: string;
      pessoaJuridicaId?: string;
      matchTipo: "CPF_CADASTRO" | "CNPJ_CADASTRO" | "NOME_CADASTRO";
      documento?: string; // mascarado para UI
    }
  | {
      tipo: "CRUZAMENTO_PDF";
      movimentacaoIds: string[];
      regra: string; // ex. MESMA_DATA_VALOR_CPF, NOME_PIX_CPF_COMPLETO
      detalhe?: string;
    }
  | {
      tipo: "IA_CRUZAMENTO";
      confianca: number;
      detalhe?: string;
    }
  | {
      tipo: "INDISPONIVEL";
      motivo: string; // ex. ingestao_anterior, ia_sem_bbox
    };
```

**Ordem na lista:** preferência de leitura — `PDF` → `CRUZAMENTO_PDF` → `CADASTRO_UF` → `IA_CRUZAMENTO`.

### 4.3 Pós-aprovação

Ao aprovar evento de consolidação:

1. Movimentação **canônica** recebe `origem_extracao` da linha preferida (`COMPLETO` com CPF, senão primeira linha com `origem_extracao` não nula).
2. Copiar refs `CADASTRO_UF` / `CRUZAMENTO_PDF` de `origem_atributos` para `movimentacao.origem_enriquecimento` (jsonb) na canônica. O kanban lê `origem_extracao` + `origem_enriquecimento`; `match_evidencia` permanece para compatibilidade com match legado, sem duplicar proveniência estruturada.

### 4.4 Migração Drizzle

- `movimentacao.origem_extracao` jsonb NULL
- `movimentacao.origem_enriquecimento` jsonb NULL (pós-merge)
- `consolidacao_evento.origem_atributos` jsonb NULL

Sem backfill.

---

## 5. Ingestão e IA

### 5.1 Schema OpenRouter (`extrato_transacoes`)

Cada item do array passa a incluir:

| Campo | Obrigatório | Notas |
|-------|-------------|-------|
| `pagina` | sim (após deploy) | 1-based |
| `indice_linha` | sim | 1-based na página |
| `bbox` | não | `{ x, y, w, h }` normalizado 0–1 |
| `campos` | não | sub-origens por campo quando IA distinguir CPF vs nome |

Prompt: instruir modelo a não inventar linhas; `indice_linha` segue ordem visual na página; bbox envolve a linha da transação.

### 5.2 Batch multipágina

Em `extractTransactionsFromPdfFile`, para cada batch `index`:

- `pagina` = `index + 1` quando `pagesPerBatch === 1` (padrão atual)
- Se batch cobrir várias páginas, `pagina` = página inicial do batch + offset inferido do modelo ou primeira página do intervalo

**Prioridade:** valor calculado pelo pipeline **sobrescreve** `pagina` retornada pela IA quando o batch é single-page (evita alucinação de número de página).

### 5.3 Fluxo `ingestPdfExtrato`

```
extract → rowFromExtraction (+ origem) → persistTransactions
```

`rowsFromExtratoTransactions` propaga metadados de origem para `ParsedTransactionRow`.

### 5.4 Legado

Uploads anteriores ao deploy: `origem_extracao = null`. UI: badge **Origem indisponível (ingestão anterior)**. Sem botão “reprocessar” na v1.

---

## 6. Motor de consolidação

### 6.1 Montagem de `origem_atributos`

| Atributo evento | Origens |
|-----------------|---------|
| `dataMovimento`, `valor`, `direcao` | `PDF` por cada `consolidacao_linha` com `movimentacao.origem_extracao`; se duas linhas iguais, duas refs |
| `pessoa` | `PDF` (CPF/cnpj na descrição), ou `CADASTRO_UF`, ou `CRUZAMENTO_PDF` (nome PIX + CPF só no completo) |
| `confianca` | `CRUZAMENTO_PDF` com `regra` + peso; `IA_CRUZAMENTO` se `consolidacao/ai.ts` participar |

Função dedicada: `buildOrigemAtributos(draft, movs, ctx)` em `@spc-up/core`, testada com fixture Bahia.

### 6.2 Hipóteses laterais

`consolidacao_hipotese.payload` pode incluir `origemAlternativa: OrigemRef` para pessoa ou par PDF alternativo.

---

## 7. APIs

| Método | Rota | Notas |
|--------|------|-------|
| GET | `/api/arquivos-ingestao/:id/pdf` | Stream/proxy do PDF (auth: mesma sessão/UF); `Content-Type: application/pdf` |
| GET | `/api/movimentacoes/:id` | Incluir `origem_extracao`, `origem_enriquecimento` |
| GET | `/api/prestacao/sessoes/:id/consolidacao` | Incluir `origem_atributos` por evento |

Headers de cache curtos; URL do blob não exposta diretamente ao cliente se política exigir proxy.

---

## 8. UI

### 8.1 Consolidação (`consolidacao-table` expandido)

- Seção **Origem por campo**: tabela `Atributo | Fonte | Detalhe | Ação`
- `PDF` → botão **Ver no PDF** abre drawer/modal
- `CADASTRO_UF` → link `/pessoas` com query documento
- `CRUZAMENTO_PDF` → lista nomes de arquivo + regra
- `INDISPONIVEL` → texto cinza

### 8.2 Viewer PDF (pdf.js)

- Carregar via `/api/arquivos-ingestao/:id/pdf`
- Ir para `pagina` (1-based)
- Desenhar overlay retângulo com `bbox` normalizado
- Sem `bbox`: scroll até página + destaque textual opcional da `descricao_raw` (fallback degradado, não substitui pedido de bbox da IA)

### 8.3 Kanban (`ReviewDrawer`)

- Mesmo componente `OrigemPanel` reutilizado
- Movimentação com `movimentacao_canonica_id` → mensagem + link para canônica
- Uma âncora PDF principal; lista de enriquecimentos (cadastro/cruzamento)

---

## 9. Erros e limites

| Caso | Comportamento |
|------|----------------|
| `origem_extracao` null | UI: origem indisponível |
| IA omite `bbox` | Viewer abre na página; exibir “linha N” |
| `bbox` inválido | Ignorar bbox na persistência |
| Atributo só cadastro | Só `CADASTRO_UF`; sem ação PDF |
| Múltiplas refs no mesmo atributo | Lista completa na UI |
| PDF inacessível (blob) | Erro amigável no viewer; metadados texto permanecem |

**Fora de v1:** reprocessar sessões antigas, OFX, export SPCA com bbox, prova por campo em XML, fuzzy nome.

---

## 10. Testes

| Teste | Método |
|-------|--------|
| Batch 3 páginas → `pagina` correta por tx | Unit `openrouter` / ingest mock |
| `origem_extracao` persistido | Integration ingest |
| Evento PIX+completo → `origem_atributos.pessoa` múltiplas fontes | Unit `buildOrigemAtributos` + fixture Bahia |
| Aprovar → canônica com origem | Integration `approve.ts` |
| bbox clamp | Unit validador |
| API PDF 403 cross-sessão | Route test |

E2E manual: consolidação → Ver no PDF → página/retângulo coerente com extrato Jan PIX / TOTAL janeiro.

---

## 11. Implementação sugerida (fases)

1. Migração + tipos TS + validador `origem_extracao`
2. Schema/prompt IA + pipeline ingest com `pagina` por batch
3. `buildOrigemAtributos` + persist consolidação
4. API PDF proxy + `OrigemPanel` + viewer
5. Aprovação copia origem para canônica + `ReviewDrawer`
6. Testes fixture Bahia

---

## 12. Referências de código

- Ingest PDF: `packages/core/src/ingest/pdf.ts`, `packages/core/src/ai/openrouter.ts`
- Split páginas: `packages/core/src/ingest/pdf-split.ts`
- Consolidação: `packages/core/src/consolidacao/*`
- UI: `apps/web/components/prestacao/consolidacao-table.tsx`, `review-drawer.tsx`
- Storage: `arquivo_ingestao.caminho_storage`, upload em `apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`
