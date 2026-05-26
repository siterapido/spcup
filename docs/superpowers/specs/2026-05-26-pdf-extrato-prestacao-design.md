# Extração de extrato bancário (PDF) na prestação — Design

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:** `2026-05-26-fluxo-prestacao-contas-design.md`, `2026-05-25-spc-up-prestacao-contas-design.md`

---

## 1. Resumo

Estender a ingestão de PDF no fluxo de **prestação de contas** para suportar **extratos bancários** com **múltiplas movimentações** por arquivo. Extração **híbrida**: texto local (`pdf-parse`) quando o PDF tiver texto suficiente; **fallback** para leitura do PDF via OpenRouter (visão) em scans ou PDFs sem camada de texto. Apenas linhas com **CPF ou CNPJ válido** (regra B) viram `movimentacao`. Piloto limitado a extratos **pequenos** (1–3 páginas, ~30 linhas), processados de forma **síncrona** no upload existente.

---

## 2. Decisões de produto

| Tema | Decisão |
|------|---------|
| Tipo de PDF | Extrato bancário (várias linhas de movimento) |
| Extração | Híbrido: texto local → fallback IA no PDF |
| Escala piloto | S: 1–3 páginas, até ~30 linhas; sync no upload |
| Contraparte | Regra **B**: só persiste linha com CPF **ou** CNPJ válido (`normalizeCpf` / `normalizeCnpj`) |
| Linhas sem documento | Ignoradas; contador `linhas_ignoradas_sem_doc` na resposta |
| Comprovante 1 tx | Fora do escopo; PDF sem tabela pode gerar 0–1 linha se houver doc válido |
| Async / Workflow | Fora do escopo (tamanho S) |
| Parser por banco | Fora do escopo |

---

## 3. Arquitetura

### 3.1 Fluxo

```
Wizard upload (.pdf)
  → POST /api/prestacao/sessoes/:id/upload  (sync, maxDuration 300)
  → ingestFileBuffer
       → arquivo_ingestao PROCESSANDO
       → ingestPdfExtrato
            1. extractPdfText(buffer)                    // pdf-parse
            2. if text.length < MIN_TEXT_CHARS
                 → extractTransactionsFromPdfFile(buffer) // OpenRouter + PDF base64
               else
                 → extractTransactionsFromPdfText(text) // OpenRouter + texto
            3. for each item in transacoes[]:
                 try normalizeCpf / normalizeCnpj
                 if none valid → skip (linhas_ignoradas_sem_doc++)
                 else → ParsedTransactionRow
            4. persistTransactions(rows) + applyAiMatchToMovimentacao per id
       → arquivo_ingestao CONCLUIDO (+ metadados na resposta API)
```

### 3.2 Componentes

| Componente | Responsabilidade |
|------------|------------------|
| `packages/core/src/ingest/pdf-text.ts` | Extração de texto com `pdf-parse`; validação de páginas |
| `packages/core/src/ai/openrouter.ts` | Novos métodos: extração estruturada em **array** (texto ou PDF) |
| `packages/core/src/ingest/pdf.ts` | `ingestPdfExtrato`: orquestra híbrido, filtro B, persist + match |
| `packages/core/src/ingest/pipeline.ts` | `.pdf` → `ingestPdfExtrato` (substitui fluxo de 1 transação para extrato) |
| `apps/web` … `upload/route.ts` | Expõe contadores extras na resposta JSON |
| `apps/web` … `wizard.tsx` | Feedback: criadas + ignoradas sem doc |

### 3.3 Substituição do fluxo atual

O fluxo atual (`extractStructuredFromPdf` + 1 `movimentacao`) será substituído para uploads `.pdf` no pipeline de prestação por `ingestPdfExtrato`. A função legada pode permanecer exportada para CLI/testes até remoção explícita, mas **não** será o caminho padrão do wizard.

---

## 4. Extração híbrida

### 4.1 Constantes (piloto)

| Constante | Valor | Notas |
|-----------|-------|-------|
| `MIN_TEXT_CHARS` | 200 | Abaixo → fallback visão |
| `MAX_PAGES` | 3 | Acima → erro antes da IA |
| `OPENROUTER` timeout / retries | 60s, 3 tentativas | Igual implementação atual |

### 4.2 Caminho texto

1. `pdf-parse` no buffer → `text`, `numpages`.
2. Se `numpages > MAX_PAGES` → erro: *"Extrato com mais de 3 páginas; divida o arquivo ou use a CLI."*
3. Se `text.trim().length >= MIN_TEXT_CHARS` → OpenRouter com **apenas texto** (sem base64).
4. Prompt: extrair **todas** as linhas de movimento (crédito/débito); ignorar saldo anterior, totais e cabeçalhos repetidos.

### 4.3 Caminho visão (fallback)

Mesmo schema JSON e mesmas regras de negócio; entrada = PDF em base64 (padrão já usado em `extractStructuredFromPdf`).

### 4.4 Schema de resposta (OpenRouter `json_schema`)

```json
{
  "type": "object",
  "properties": {
    "transacoes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "data": { "type": "string", "description": "YYYY-MM-DD" },
          "valor": { "type": "number" },
          "direcao": { "type": "string", "enum": ["ENTRADA", "SAIDA"] },
          "descricao": { "type": "string" },
          "cpf": { "type": "string" },
          "cnpj": { "type": "string" },
          "nome": { "type": "string" }
        },
        "required": ["data", "valor", "direcao", "descricao"],
        "additionalProperties": false
      }
    }
  },
  "required": ["transacoes"],
  "additionalProperties": false
}
```

`cpf`, `cnpj` e `nome` são opcionais na resposta da IA; a persistência aplica a regra B no código.

---

## 5. Regra B — persistência

Para cada item em `transacoes`:

1. Tentar `normalizeCpf(item.cpf)` se presente.
2. Se falhar, tentar `normalizeCnpj(item.cnpj)` se presente.
3. Se nenhum documento válido → **não** inserir `movimentacao`; incrementar `linhas_ignoradas_sem_doc`.
4. Se válido → mapear para `ParsedTransactionRow`:
   - `dataMovimento`, `valor`, `direcao` como em `rowFromExtraction` hoje.
   - `descricaoRaw`: `descricao`; se `nome` presente, compor `"${nome} …"` na descrição (CPF/CNPJ podem ser citados na descrição para auditoria humana).
   - `nrExtratoBancario`: `null` (extrato não traz por linha no piloto).

**Dedup:** reutilizar `hash_movimento` e lógica de `persistTransactions` (inclui `cnpj_prestador` da sessão). Duplicatas não incrementam `movimentacoes_criadas`; opcional expor `linhas_duplicadas` na resposta da API.

**Resultado parcial:** se algumas linhas têm doc e outras não, o arquivo termina `CONCLUIDO` com as movimentações válidas e contadores de ignoradas.

---

## 6. Erros e `arquivo_ingestao`

| Situação | Status | Resposta |
|----------|--------|----------|
| OpenRouter falha após retries | `ERRO` | Mensagem de erro por arquivo |
| PDF inválido / parse falha | `ERRO` | Mensagem clara |
| > 3 páginas | `ERRO` | Mensagem de limite piloto |
| 0 linhas com doc válido | `CONCLUIDO` | `movimentacoes_criadas: 0` + aviso sem doc |
| Mix válidas / inválidas | `CONCLUIDO` | `linhas_ignoradas_sem_doc` > 0 |

---

## 7. API e UI

### 7.1 Resposta upload (extensão)

Por arquivo processado, além de `movimentacoes_criadas`:

```typescript
{
  nome: string;
  movimentacoes_criadas: number;
  linhas_ignoradas_sem_doc?: number;
  linhas_duplicadas?: number;
}
```

### 7.2 Wizard

Após upload, exibir por arquivo:

- *"N movimentações criadas"*
- Se `linhas_ignoradas_sem_doc > 0`: *"M linhas ignoradas (sem CPF/CNPJ válido no extrato)"*

Kanban: apenas movimentações persistidas.

---

## 8. Testes

| Caso | Expectativa |
|------|-------------|
| Texto ≥ 200 chars | Mock OpenRouter texto; sem chamada visão |
| Texto < 200 chars | Mock OpenRouter visão |
| 3 transações, 1 sem doc | 2 movimentações criadas; `linhas_ignoradas_sem_doc === 1` |
| CPF inválido, CNPJ válido | Linha aceita via CNPJ |
| `numpages > 3` | Erro antes da IA |
| Integração `ingestPdfExtrato` | Mock extração + DB de teste |

Fixtures: trechos de extrato em texto (`.txt` / strings em teste), sem PDFs grandes no repositório.

---

## 9. Dependências e configuração

| Item | Detalhe |
|------|---------|
| Dependência | `pdf-parse` em `@spc-up/core` |
| `OPENROUTER_API_KEY` | Obrigatório para PDF |
| `OPENROUTER_PDF_MODEL` | Opcional; default `anthropic/claude-sonnet-4` se ausente |
| `OPENROUTER_MODEL` | Continua usado pelo match Kimi (`moonshotai/kimi-k2.6` em produção) |

---

## 10. Fora de escopo

- Revisão UI das linhas descartadas pela IA
- Ingestão assíncrona (Vercel Workflow) — prevista na migration spec para PDFs grandes
- OCR local (Tesseract)
- Parsers específicos por instituição financeira
- Colunas dedicadas `cpf` / `cnpj` em `movimentacao` (permanecem na descrição + match IA)

---

## 11. Critérios de aceite

1. Upload de extrato PDF (1–3 páginas) na sessão de prestação cria **N** movimentações quando N linhas têm CPF ou CNPJ válido.
2. Linhas sem documento válido não aparecem no kanban; API informa contagem ignorada.
3. PDF com texto nativo usa caminho texto (verificável em teste com mock).
4. PDF scan (pouco texto) usa fallback visão.
5. Testes unitários/integração em `packages/core` cobrem filtro B e ramos híbrido.
