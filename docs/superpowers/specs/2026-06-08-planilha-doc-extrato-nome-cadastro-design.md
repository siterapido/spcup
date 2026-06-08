# Planilha — Doc. do extrato, comparação Nome×cadastro, descrição única (Design)

**Data:** 2026-06-08
**Cliente:** Unidade Popular (UP) — SPC UP
**Status:** Aprovado (grill-me 2026-06-08)
**Relacionado:**
- [2026-06-08-planilha-nome-contraparte-design.md](./2026-06-08-planilha-nome-contraparte-design.md)
- [2026-06-07-planilha-unificada-design.md](./2026-06-07-planilha-unificada-design.md)

---

## 1. Resumo

Três ajustes na planilha unificada (`/prestacao/[id]/planilha`), a partir de feedback de uso:

1. **Doc./Extrato vazio:** a coluna exibe `—` mesmo quando o n.º Documento existe no PDF. Causa: o schema de extração da IA não tem o campo `documento`. Corrigir a extração para capturá-lo.
2. **Comparar Nome extraído × cadastro:** exibir o nome extraído ao lado do nome da pessoa vinculada (PF/PJ) com destaque visual de divergência (verde = bate, âmbar = difere).
3. **Descrição redundante:** "Descrição" (limpa) e "Descrição Original" (raw) ficam idênticas quando não há prefixo bancário; remover a coluna "Descrição Original".

Busca por PF/pessoa já funciona — sem mudança.

---

## 2. Decisões de produto (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | "Doc./Extrato" | Campo é o **n.º Documento da transação** (`nrExtratoBancario`), distinto do CPF/CNPJ da contraparte. Valor existe no PDF mas não é extraído |
| 2 | Causa raiz #1 | Schema `EXTRATO_TRANSACTION_ITEM_SCHEMA` não tem `documento`; IA nunca retorna. `nrExtratoBancarioFromExtratoItem` já lê `item.documento` |
| 3 | Escopo do fix #1 | Adicionar `documento` ao schema + prompts. Vale para **ingests novos**; dados atuais seguem `null` (reprocessar fora de escopo) |
| 4 | Comparação Nome×cadastro | **Lado a lado + destaque** (A): coluna Nome (extraído) ao lado de PF/PJ (cadastro), com indicador verde/âmbar e tooltip "extraído: X / cadastro: Y" |
| 5 | Regra de match Nome | **Normalizado contém** (A): `normalizeName` nos dois; verde se iguais OU um contém o outro; âmbar caso contrário. Sem fuzzy |
| 6 | Descrição redundante | **Remover "Descrição Original"** (A); manter só "Descrição" (limpa). Raw segue acessível ao expandir Origens |

---

## 3. #1 — Doc./Extrato (extração)

### 3.1 Causa

```
EXTRATO_TRANSACTION_ITEM_SCHEMA  →  sem campo "documento"
        ↓ (IA não retorna documento)
nrExtratoBancarioFromExtratoItem(item)  →  item.documento = undefined  →  null
        ↓
coluna "Doc./Extrato"  →  "—"
```

`nrExtratoBancarioFromExtratoItem` (`packages/core/src/ingest/pdf.ts`) **já** lê
`item.documento ?? item.nr_documento ?? item.nrDocumento` — não muda.

### 3.2 Fix

Adicionar ao `EXTRATO_TRANSACTION_ITEM_SCHEMA` (`packages/core/src/ai/openrouter/schemas.ts`):

```typescript
documento: {
  type: ["string", "null"],
  description:
    "Número do Documento/lançamento da transação no extrato (coluna 'Documento'/'Nº Doc'); null se ausente. NÃO é CPF/CNPJ.",
},
```

Incluir `"documento"` na lista `required` (schema é `strict`).

Atualizar os prompts (`KIMI_EXTRATO_SYSTEM_PROMPT`, `GEMINI_EXTRATO_SYSTEM_PROMPT`,
JSON de exemplo) para extrair `documento` por transação.

### 3.3 Limite

Dados já ingeridos continuam com `nrExtratoBancario = null` (a IA não foi rodada com
o novo schema). Backfill/reprocessamento fora de escopo.

---

## 4. #2 — Comparação Nome extraído × cadastro

### 4.1 Dados

`PlanilhaLinha` já tem:
- `nome` — nome efetivo (extraído/derivado ou override do operador)
- `pessoa: { nome } | null` — pessoa vinculada do cadastro (PF/PJ)

### 4.2 Regra de comparação (helper puro)

`compararNomeCadastro(extraido: string, cadastro: string): "bate" | "difere" | "indefinido"`

```
a = normalizeName(extraido); b = normalizeName(cadastro)
se a.length <= 3 ou b.length <= 3 → "indefinido"
se a === b OU a.includes(b) OU b.includes(a) OU isTokenSubset(a,b) → "bate"
senão → "difere"
```

`isTokenSubset`: todos os tokens do nome menor estão presentes no maior
(cobre "MARIA SILVA" vs "MARIA DA SILVA SOUZA", que não é substring direta).

`normalizeName` (uppercase + sem acento + colapsa espaços) — exportar de
`@spc-up/core/browser` para uso client-side.

### 4.3 UI

Na célula **Nome** (`PlanilhaNomeCell`), quando há `pessoa` vinculada:
- indicador ao lado do input: ponto **verde** (`bate`), **âmbar** (`difere`), nenhum (`indefinido`)
- `title`/tooltip: `extraído: <nome> / cadastro: <pessoa.nome>`

`PlanilhaNomeCell` recebe nova prop `pessoaNome?: string | null`.
Sem destaque quando não há pessoa vinculada ou nome extraído vazio.

---

## 5. #3 — Descrição única

`planilha-table.tsx`:
- remover `<th>Descrição Original</th>` e a `<td>` correspondente (`linha.descricaoRaw`)
- manter coluna "Descrição" (`linha.descricao`, limpa)
- `descricaoRaw` segue visível por origem ao expandir "Origens"
- ajustar `colSpan` da linha-vazia (13 → 12)

---

## 6. Testes de aceite

| # | Cenário | Esperado |
|---|---------|----------|
| 1 | Extrato com coluna Documento, ingest novo | "Doc./Extrato" mostra o n.º documento |
| 2 | `documento` ausente na linha | "Doc./Extrato" = `—` (sem erro) |
| 3 | Nome extraído = nome cadastro | indicador verde, tooltip com os dois |
| 4 | Nome extraído ≠ cadastro | indicador âmbar |
| 5 | Linha sem pessoa vinculada | sem indicador |
| 6 | `compararNomeCadastro("MARIA SILVA","MARIA DA SILVA SOUZA")` | `bate` (contém) |
| 7 | Planilha renderiza | uma só coluna de descrição; layout sem coluna vazia |

---

## 7. Arquivos

| Arquivo | Ação |
|---------|------|
| `packages/core/src/ai/openrouter/schemas.ts` | Modificar — campo `documento` + prompts |
| `packages/core/src/normalize.ts` | (sem mudança — só reexport) |
| `packages/core/src/browser.ts` | Modificar — exportar `normalizeName` |
| `packages/core/src/match/nome-cadastro.ts` | Criar — `compararNomeCadastro` |
| `packages/core/src/match/nome-cadastro.test.ts` | Criar |
| `apps/web/components/prestacao/planilha-nome-cell.tsx` | Modificar — prop `pessoaNome` + indicador |
| `apps/web/components/prestacao/planilha-table.tsx` | Modificar — remover coluna; passar `pessoaNome`; `colSpan` |

---

## 8. Fora de escopo

- Backfill/reprocessamento de sessões já ingeridas para preencher `documento`
- Fuzzy match de nomes (similaridade por score)
- Mostrar CPF/CNPJ da contraparte como coluna própria (segue no PF/PJ)
