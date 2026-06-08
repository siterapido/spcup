# Mapeamento de colunas de extrato (PDF) no wizard — Design

**Data:** 2026-06-02  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (brainstorming 2026-06-02)  
**Relacionado:** `2026-05-26-pdf-extrato-prestacao-design.md`, `2026-05-26-fluxo-prestacao-contas-design.md`, `2026-05-26-documentos-teste-ingestao-descobertas.md`

---

## 1. Resumo

Adicionar ao wizard de prestação um passo **obrigatório** entre **Anexos** e **Enviar/processar**, em que o operador **mapeia colunas do extrato bancário (PDF)** clicando na prévia da primeira página. O mapeamento inclui campos padrão do sistema e **campos ad hoc** criados na hora. O mapa vale **por arquivo PDF** (todas as páginas) e é usado **apenas para orientar a extração por IA** (prompt); não persiste em `movimentacao` nem no export SPCA.

---

## 2. Decisões de produto

| Tema | Decisão |
|------|---------|
| Momento | Antes de processar cada PDF (passo dedicado no wizard) |
| Obrigatoriedade | Obrigatório para todo `.pdf` da sessão; Excel/OFX fora do escopo |
| Campos | Lista padrão + “Adicionar campo” com nome livre (sem catálogo global/admin) |
| Associação coluna | Clique na prévia da página |
| Escopo do mapa | Um mapeamento por arquivo; `paginaReferencia` = 1; aplica a todas as páginas |
| Campos custom | Só hint no prompt da IA; descartados após extração |
| Persistência do mapa | Não em `movimentacao`; opcional log em `arquivo_ingestao.metadados` na v1 (suporte) |
| Abordagem técnica | **Mapear no cliente** antes do envio (pdf.js na página 1); mapa enviado no processamento |

---

## 3. Campos mapeáveis

### 3.1 Padrão (sugeridos na UI)

| Campo (`campo`) | Descrição | Obrigatório para avançar |
|-----------------|-----------|--------------------------|
| `data` | Data do lançamento | Sim |
| `valor` | Valor monetário | Sim |
| `direcao` | Entrada/saída explícita, ou opção “inferir do valor” | Sim* |
| `documento` | CPF/CNPJ (uma coluna ou duas no PDF) | Condicional** |
| `nome` | Nome da contraparte | Condicional** |
| `historico` | Histórico / descrição / complemento | Recomendado |
| `cred_dev` | Cód. Cred/Dev, tipo PIX, etc. | Não |
| `hora` | Hora do lançamento | Não |

\* Se o extrato não tiver coluna de direção, o usuário escolhe “inferir pela coluna **valor**” (sinal ou colunas débito/crédito separadas — ver validação).  
\** Para avançar: `documento` mapeado **ou** (`nome` **e** `historico` mapeados), alinhado à regra B e ao fallback por nome no cadastro.

### 3.2 Campos ad hoc

- Botão **“Adicionar campo”**: nome livre (`label` exibido; `campo` = slug gerado, ex. `custom_nro_doc`).
- Entram na mesma lista de mapeamento por clique.
- Usados **somente** no prompt de extração (ex.: “coluna 4 = Nº documento”).

### 3.3 Fora do escopo do mapeamento

`pagina`, `bbox`, `indice_linha` — continuam inferidos pela pipeline de ingestão/proveniência.

---

## 4. Fluxo do wizard

### 4.1 Etapas

| Id | Label (UI) | Notas |
|----|------------|-------|
| 1–5 | UF, Tipo, Prestador, Exercício, Anexos | Inalterados |
| **6** | **Mapear extratos** | Novo em `WIZARD_STEPS`; só se houver ≥1 PDF |
| — | Enviar / processar | Como hoje, após mapa completo |

Renumerar `END_TO_END_FLOW_STEPS`: **Movimentações** → id 7, **Export** → id 8 (hoje id 6–7).

```mermaid
flowchart LR
  A[Anexos] --> B[Mapear extratos]
  B --> C[Enviar]
  C --> D[Sessão + upload]
  D --> E[Processar páginas PDF]
```

### 4.2 Múltiplos PDFs

- Um card (ou passo) por arquivo: “Extrato 1 de N”.
- Indicador por arquivo: pendente / mapeado.
- **Enviar** desabilitado até todos os PDFs validados.

### 4.3 Arquivos não-PDF

- OFX/Excel: fluxo atual, sem passo 6.

---

## 5. UI — tela de mapeamento

### 5.1 Layout (por PDF)

- **Esquerda:** prévia da página 1 (`pdf.js` no cliente a partir do `File` selecionado em Anexos).
- **Direita:** lista de campos (padrão + ad hoc) com estado de mapeamento.

### 5.2 Interação

1. Usuário seleciona um campo na lista (destaque).
2. Modo **mapear**: clique na prévia associa a coluna ao campo selecionado.
3. Feedback: “Coluna 2 — Histórico” ou rótulo detectado.
4. Ações: **Limpar** campo; **Refazer** mapa do arquivo.

### 5.3 Regra de clique

| PDF | Comportamento |
|-----|----------------|
| Com camada de texto | Associar ao item de texto mais próximo (preferir linha de cabeçalho); preencher `colunaIndex`, `headerLabel` |
| Scan (sem texto) | Estimar `colunaIndex` pela posição horizontal do clique; opcional `xInicio` / `xFim` normalizados (0–1) |

### 5.4 Validação (habilitar “Próximo” / “Enviar”)

- `data` e `valor` mapeados.
- `direcao` mapeada **ou** opção “inferir do valor” selecionada.
- `documento` **ou** (`nome` + `historico`).
- Campos ad hoc: opcionais (não bloqueiam).

### 5.5 Erros de UX

- PDF sem estrutura tabular reconhecível: mensagem clara; orientar dividir arquivo ou suporte.
- Troca de arquivo em Anexos: invalidar mapa daquele arquivo.

---

## 6. Arquitetura

### 6.1 Abordagem escolhida

**Mapeamento no cliente antes do envio** (rejeitadas para v1: mapeamento pós-upload obrigatório; pré-passagem IA só para sugerir cabeçalhos).

### 6.2 Componentes

| Componente | Responsabilidade |
|------------|------------------|
| `apps/web` — `prestacao-flow-steps.ts` | Incluir etapa 6 “Mapear extratos” |
| `apps/web` — `wizard.tsx` | Orquestrar passo 6; bloquear submit |
| `apps/web` — `extrato-column-map-panel.tsx` (novo) | Prévia pdf.js + lista de campos + cliques |
| `apps/web` — `use-extrato-column-map.ts` (novo) | Estado por `File` (nome + hash ou índice) |
| `apps/web` — `use-prestacao-submit.ts` | Anexar `extratoColumnMaps` ao upload/processamento |
| `apps/web` — rotas upload/processar | Aceitar mapa por arquivo |
| `packages/core` — `extrato-column-map.ts` (novo) | Tipos, validação, `buildExtratoColumnPromptHint()` |
| `packages/core` — `ai/openrouter/extrato.ts` | Incluir hint no prompt texto/visão |
| `packages/core` — `ingest/dual-extract.ts` | Repassar hint no fluxo por página |

### 6.3 Fluxo de dados

```
File (PDF) + ExtratoColumnMap (client)
  → POST upload (armazenar) + mapa em body/JSON paralelo por arquivo_id ou nome
  → processarPaginaPdfExtrato(pagina, { extratoColumnMap })
       → buildExtratoColumnPromptHint(map)
       → extractTransactionsFromPdfText | FromImagePng | dual-extract
       → transações (schema atual)
       → persist movimentacao (sem campos custom do mapa)
```

Associação upload → mapa: chave estável `clientFileKey` (ex. `name + size + lastModified`) até existir `arquivo_id`; após upload, mapa keyed por `arquivo_id`.

---

## 7. Contrato de dados

```ts
type ExtratoColumnMapEntry = {
  /** Identificador estável: data, valor, documento, ou slug custom */
  campo: string;
  /** Rótulo exibido para campos ad hoc */
  label?: string;
  /** Índice 0-based, esquerda → direita */
  colunaIndex: number;
  /** Texto do cabeçalho quando detectável */
  headerLabel?: string;
  /** Faixa horizontal normalizada (scan); opcional */
  xInicio?: number;
  xFim?: number;
};

type ExtratoColumnMap = {
  paginaReferencia: 1;
  inferirDirecaoDoValor?: boolean;
  colunas: ExtratoColumnMapEntry[];
};
```

Payload por arquivo no processamento:

```json
{
  "arquivoId": "uuid",
  "extratoColumnMap": { "paginaReferencia": 1, "colunas": [ ... ] }
}
```

### 7.1 Prompt (exemplo)

Trecho injetado em system ou user message:

> O extrato usa colunas da esquerda para a direita (índice 0-based). Mapeamento informado pelo operador: coluna 0 = data; coluna 1 = valor; coluna 2 = historico (rótulo "Histórico"); coluna 3 = documento. Direção: inferir pelo sinal da coluna valor. Campos adicionais: coluna 4 = "Nº doc." (custom). Respeite este layout ao extrair todas as linhas de movimento em todas as páginas.

---

## 8. Fora de escopo (v1)

- Catálogo global ou templates por banco salvos entre sessões.
- Mapeamento por página com layouts diferentes (exceções por página).
- Persistir valores de campos custom em `movimentacao` ou export SPCA.
- Mapeamento para Excel de extrato (só PDF).
- Pré-passagem IA só para detectar cabeçalhos antes do clique.

---

## 9. Erros e observabilidade

| Situação | Comportamento |
|----------|----------------|
| Mapa ausente no processamento de PDF | 400 / erro de validação (não deve ocorrer se wizard bloqueou) |
| Mapa inconsistente com extração | IA pode falhar parcialmente; fluxo `VERIFICAR` existente |
| Suporte | Opcional: gravar cópia do mapa em `arquivo_ingestao.metadados.extratoColumnMap` |

---

## 10. Testes

| Nível | Caso |
|-------|------|
| Unit | `buildExtratoColumnPromptHint` — padrão, custom, inferir direção |
| Unit | Validação mínima do mapa (data+valor+documento OU nome+historico) |
| Component | Clique associa `colunaIndex` (mock pdf.js text layer) |
| Integração | Upload + processar com mapa mock → prompt contém hint (snapshot ou spy) |
| E2E | Wizard: 2 PDFs, mapear ambos, submit habilitado |

---

## 11. Critérios de aceite

1. Wizard exige passo **Mapear extratos** quando há PDF(s).
2. Operador mapeia por clique na prévia da página 1; pode adicionar campos custom com nome livre.
3. Um mapa por PDF aplica-se a todas as páginas no processamento.
4. Extração OpenRouter/dual-extract recebe hint de colunas; campos custom não aparecem na movimentação exportada.
5. Enviar bloqueado até validação mínima em todos os PDFs.

---

## 12. Sucessor

Plano de implementação: `docs/superpowers/plans/2026-06-02-pdf-extrato-mapeamento-colunas.md` (via skill **writing-plans**).
