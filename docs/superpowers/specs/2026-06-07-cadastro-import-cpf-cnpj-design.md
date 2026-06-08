# Importação de cadastro — CPF/CNPJ e mapeamento (Design)

**Data:** 2026-06-07  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado  
**Relacionado:** [2026-05-26-cadastro-pf-pj-design.md](./2026-05-26-cadastro-pf-pj-design.md)

---

## 1. Resumo executivo

Melhorar importação de pessoas (`/pessoas/importar`) para tratar corretamente CPF e CNPJ vindos de planilhas Excel/CSV, incluindo:

- Pontos, traços, barras e espaços na máscara
- Zeros à esquerda removidos pelo Excel (célula numérica)
- Decimais artificiais (`.0`, `,00`) em células numéricas
- Inferência PF/PJ pelo tamanho do documento após limpeza
- CNPJ alfanumérico (padrão TSE: 12 alfanum + 2 dígitos)

Abordagem escolhida: **normalização inteligente no parse** (`packages/core/src/cadastro/parse.ts`), sem UI de correção manual linha a linha.

---

## 2. Problema atual

| Sintoma | Causa provável |
|---------|----------------|
| CPF com menos de 11 dígitos rejeitado | Excel armazena como número; zeros à esquerda perdidos |
| CNPJ inválido após import | Mesmo problema com 12–13 dígitos visíveis |
| Tipo PF/PJ errado ou "tipo inválido" | `inferTipoFromDocumento` exige exatamente 11 ou 14 dígitos **antes** do pad |
| Documento com `.00` falha | `cellToText` não remove sufixo decimal de string |
| Mapeamento de colunas falha | Cabeçalhos com pontuação ou aliases não reconhecidos |

O fluxo web (`CadastroImportForm` → `/api/pessoas/import/preview` → `parseCadastroSpreadsheet`) já suporta mapeamento manual e planilhas sem cabeçalho; o gargalo está na **normalização pré-validação** em `parseRow` / `cellToText` / `inferTipoFromDocumento`.

---

## 3. Decisões de produto

| Tema | Decisão |
|------|---------|
| Abordagem | Normalização automática no core (Abordagem 2) |
| CPF | Após limpeza: se tamanho ≤ 11 → PF, `padStart(11, "0")`, validar dígitos verificadores |
| CNPJ | Após limpeza: se tamanho > 11 e ≤ 14 → PJ, `padStart(14, "0")`, validar padrão TSE |
| CNPJ alfanumérico | Manter `normalizeCnpj` existente; pad só em parte numérica quando aplicável |
| Tipo explícito na planilha | Respeitar coluna `tipo` quando válida; senão inferir pelo tamanho |
| Validação estrita pós-pad | CPF/CNPJ inválidos após normalização → erro na linha (não abortar arquivo) |
| UI | Sem modal de correção; mensagens de erro mais claras na tabela de falhas |
| Escopo fora | Re-match, conflitos de nome, novas colunas na planilha |

---

## 4. Regras de normalização

### 4.1 `prepareDocumentoRaw(raw: string, tipo?: "PF" | "PJ")`

Nova função interna em `parse.ts` (ou exportada para testes):

1. `text = cellToText(raw)` se entrada não for string já processada
2. Remover espaços
3. Remover sufixo decimal Excel: `/[,.]0+$/` quando resto for numérico
4. `clean = text.replace(/[^A-Za-z0-9]/g, "")` — preservar letras para CNPJ TSE
5. Se `tipo` omitido: inferir por tamanho de `clean`:
   - `clean.length === 0` → erro "Documento vazio"
   - `clean.length <= 11` → PF
   - `clean.length <= 14` → PJ
   - senão → erro "Documento com tamanho inválido"
6. Se `tipo === "PF"`: `clean = clean.replace(/\D/g, "")` then `padStart(11, "0")`
7. Se `tipo === "PJ"`: `clean = clean.toUpperCase()` then `padStart(14, "0")` (só dígitos à esquerda quando base for numérica; ver implementação)
8. Retornar `{ tipo, documento: clean }` para passar a `normalizeCpf` / `normalizeCnpj`

### 4.2 `cellToText` (melhoria)

- Números: manter lógica atual de pad por faixa 8–10 (CPF) e 12–13 (CNPJ)
- Strings: após `trim`, remover `/[,.]0+$/` se o corpo for só dígitos/pontuação de documento
- Fórmulas/rich text: recursão existente mantida

### 4.3 `inferTipoFromDocumento`

Substituir checagem de comprimento exato 11/14 por:

```text
digitsOrAlnum = raw sem máscara
length <= 11  → PF
length <= 14  → PJ
else          → null
```

### 4.4 `cellLooksLikeDocument`

Aceitar documentos com 9–11 dígitos (CPF truncado pelo Excel) e 12–14 (CNPJ truncado) após `prepareDocumentoRaw`, não só 11/14 exatos.

---

## 5. Mapeamento de colunas

### 5.1 Aliases adicionais em `HEADER_ALIASES`

Incluir variantes comuns:

- `cpf_cnpj`, `cpf_cnpj_`, `nr_cpf_cnpj`, `documento_cpf_cnpj`
- `cnpj_cpf`, `doc_cpf_cnpj`
- `razao_social`, `nome_razao`, `nome_razao_social` (já parcialmente cobertos)
- `pessoa_fisica`, `pessoa_juridica` → **não** mapear para `tipo` se valor da coluna for nome; apenas cabeçalhos que indiquem tipo

`normalizeHeaderKey` já remove pontuação e acentos; garantir testes com `CPF/CNPJ`, `CPF.CNPJ`, `Nº Documento`.

### 5.2 Preview

Sem mudança de API; `suggestedMap` melhora com aliases e detecção de documento truncado.

---

## 6. Fluxo de dados (inalterado na superfície)

```text
[Upload planilha]
    → extractSpreadsheetHeaders (preview)
    → usuário confirma columnMap
    → parseCadastroSpreadsheet (+ prepareDocumentoRaw por linha)
    → importCadastroBatch → upsertPessoa (normalizeCpf/Cnpj finais)
```

---

## 7. Tratamento de erros

| Condição | Motivo na linha |
|----------|-----------------|
| Documento vazio | `Documento vazio` |
| Tamanho > 14 após limpeza | `Documento com tamanho inválido` |
| PF após pad falha DV | `CPF inválido: dígitos verificadores incorretos` |
| PJ falha padrão TSE | `CNPJ inválido: padrão TSE não atendido` |
| Tipo explícito inconsistente com tamanho | Preferir tipo explícito; se normalização falhar, reportar erro de validação do documento |

Não alterar comportamento de conflitos de nome (spec cadastro PF/PJ).

---

## 8. Testes

Arquivo: `packages/core/src/cadastro/parse.test.ts`

Casos novos:

| Entrada | Esperado |
|---------|----------|
| `"1234567"` (7 dígitos) | CPF `00001234567` se DV válido, ou erro DV |
| `1234567890` (número Excel) | CPF com zero à esquerda |
| `"11.222.333/0001-81"` | PJ normalizado |
| `"11222333000181"` | PJ |
| `11222333000181.0` (string) | PJ após strip decimal |
| Coluna `CPF.CNPJ` | `suggestedMap.documento` preenchido |
| Tipo explícito PJ + doc 11 dígitos | Erro de validação CNPJ (não forçar PF) |

Rodar: `pnpm --filter @spc-up/core test cadastro/parse`

---

## 9. Critérios de aceite

1. Planilha com CPF numérico sem zeros à esquerda importa com CPF correto de 11 dígitos.
2. Planilha com CNPJ numérico (12–13 dígitos visíveis) importa com 14 dígitos após pad.
3. Documentos mascarados (`000.000.000-00` formato com pontos/traços) importam após strip de máscara.
4. Cabeçalho `CPF/CNPJ` sugere mapeamento automático de `documento`.
5. Linhas inválidas aparecem em `erros[]` com motivo claro; linhas válidas continuam importando.
6. Testes existentes de `parse.test.ts` passam; novos casos cobrem regressões Excel.

---

## 10. Fora de escopo

- Preview de amostra de linhas na UI antes do import
- Correção manual linha a linha na web
- Alteração de `normalizeCnpj` para CNPJ numérico clássico (Receita) — manter TSE
- Import via CLI (se existir, herda core automaticamente)

---

## 11. Próximo passo

Plano de implementação: `docs/superpowers/plans/2026-06-07-cadastro-import-cpf-cnpj.md`
