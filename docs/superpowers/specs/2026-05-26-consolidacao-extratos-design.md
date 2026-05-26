# Consolidação multi-extrato + cadastro UF — Design

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:**
- `2026-05-26-fluxo-prestacao-contas-design.md`
- `2026-05-26-pdf-extrato-prestacao-design.md`
- `2026-05-26-cadastro-pf-pj-design.md`
- `2026-05-26-documentos-teste-ingestao-descobertas.md` (evidência Bahia)

---

## 1. Resumo

Operador pode marcar **“Consolidar extratos”** no wizard ao anexar vários PDFs (ex.: PIX + extrato completo do mesmo mês). Após ingestão, passo **`/prestacao/[sessaoId]/consolidacao`** cruza movimentações dos PDFs com o **cadastro da UF** (ex.: `pessoas bahia.xlsx` importado antes), propõe **um evento financeiro por linha principal** com **taxa de confiança** e **referências** para revisão humana. Aprovação funde duplicatas, enriquece CPF/nome e segue para o kanban.

**Objetivo:** identificar transações das pessoas cadastradas por CPF, nome, data, direção e valor — com rastreio auditável, não merge silencioso.

---

## 2. Fundamentação: testes reais (Bahia / janeiro 2025)

Fonte: `docs/superpowers/specs/2026-05-26-documentos-teste-ingestao-descobertas.md` e scripts `analyze-test-docs.ts`, `run-test-docs-ingest.ts`.

| Aprendizado | Impacto na consolidação |
|-------------|-------------------------|
| Cadastro **sem cabeçalho** (256 PF/PJ OK) | Consolidação assume cadastro já importado na UF; UI avisa se cadastro vazio |
| PDFs **escaneados** (0 chars `pdf-parse`) | Cruzamento usa `movimentacao` já extraída (visão Kimi por página); não reenviar PDF inteiro na consolidação |
| PIX: IA retorna **só nome**, sem CPF (~34 tx) | Par PIX↔completo: chave fraca = data+valor+direção + **nome normalizado**; CPF vindo do extrato completo **enriquece** o evento |
| Extrato completo (3 pág.) pode trazer **CPF na descrição** | Prioridade: CPF no completo + mesma data/valor que linha PIX nome-only → confiança **alta** |
| `hash_movimento` inclui `descricao_raw` inteira | PIX e completo **não** dedupe no banco hoje → consolidação é o lugar certo para merge |
| Match ingest: `NOME_CADASTRO` ~85% do CPF, nome **exato** | Score composto: CPF > nome único no cadastro > par PDF sem doc |
| Ordem: **cadastro → extratos → revisão** | Wizard/step consolidação bloqueia aviso se 0 pessoas na UF (soft) ou score baixo esperado |
| `dedupeExtratoTransactions` só **dentro** de 1 PDF | Consolidação precisa `dedupeCrossExtrato` entre arquivos |
| 1ª ingestão: 2+3 chamadas OpenRouter, minutos | Step consolidação roda **após** cache de ingest; regras locais primeiro, Kimi só ambíguos |
| Fuzzy nome | **Fora v1** (backlog P2); homônimos → painel “outras hipóteses” |

**Fixtures de regressão:** `Documentos para teste /Extrato Jan PIX (1).pdf`, `EXTRATO TOTAL JANEIRO (1) (1).pdf`, `pessoas bahia (1).xlsx`.

---

## 3. Decisões de produto

| Tema | Decisão |
|------|---------|
| Opt-in | Checkbox **Consolidar extratos** no wizard |
| Resultado | Dedup + enriquecimento + aprovação humana (C) |
| Fluxo | Upload → ingest por arquivo → **tela consolidação** → kanban (C) |
| Linha da lista | **1 evento financeiro**; hipóteses fracas no painel lateral (A) |
| Motor | Regras primeiro + Kimi para ambíguos (não batch único) |
| Cadastro | Nacional (`pessoa_fisica`); escopo operacional = UF da sessão |
| v1 escopo | PDF↔PDF na mesma sessão; OFX+PDF fase 2 |
| Piloto | Mesmos limites de ingestão (`MAX_EXTRATO_PAGES` default 12) |

---

## 4. Arquitetura

```
Wizard [☑ consolidar] + N PDFs (+ cadastro já em /pessoas)
  → ingestPdfExtrato (por arquivo, cache OpenRouter)
  → movimentacao (possíveis duplicatas cross-file)
  → se consolidar && ≥2 PDF extrato:
       consolidateSession(sessaoId)
         1. candidatosCrossPdf (regras)
         2. enrichWithCadastroUf (CPF, NOME_CADASTRO)
         3. evaluateAmbiguousWithKimi (opcional, cap confiança)
         4. persiste consolidacao_evento + linhas + hipóteses + evidências
  → UI /prestacao/:id/consolidacao
  → aprovar → merge + match canônica
  → kanban
```

### 4.1 Componentes (`@spc-up/core`)

| Módulo | Responsabilidade |
|--------|------------------|
| `consolidacao/candidates.ts` | Pares PIX↔completo, chaves, scores |
| `consolidacao/cadastro-uf.ts` | Lista PF/PJ “usados” na UF (movimentações da sessão + import contexto) |
| `consolidacao/persist.ts` | CRUD eventos, aprovação, merge movimentação |
| `consolidacao/ai.ts` | Kimi só quando score regras ∈ (0.45, 0.75) ou múltiplos CPF candidatos |
| Reuso | `dedupeExtratoTransactions` (intra-PDF), `normalizeName`, `extractDocumentCandidates`, `findUniquePessoaByNome`, `match_evidencia` |

### 4.2 Modelo de dados (novo)

**`consolidacao_evento`**

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `sessao_prestacao_id` | uuid | FK |
| `status` | enum | `PENDENTE`, `APROVADO`, `REJEITADO` |
| `data_movimento` | date | Canônico pós-merge |
| `valor` | numeric | |
| `direcao` | varchar | ENTRADA/SAIDA |
| `confianca` | real | 0–1 composto |
| `pessoa_fisica_id` / `pessoa_juridica_id` | uuid? | Sugestão |
| `movimentacao_canonica_id` | uuid? | Preenchido ao aprovar |
| `justificativa` | text? | Resumo humano/IA |

**`consolidacao_linha`**

| Campo | Tipo |
|-------|------|
| `evento_id` | uuid FK |
| `movimentacao_id` | uuid FK |
| `papel` | `PIX`, `COMPLETO`, `OUTRO` |
| `arquivo_ingestao_id` | uuid |

**`consolidacao_hipotese`**

| Campo | Tipo |
|-------|------|
| `evento_id` | uuid |
| `tipo` | `PESSOA_ALTERNATIVA`, `PAR_PDF_ALTERNATIVO`, `SEM_PESSOA` |
| `confianca` | real |
| `payload` | jsonb (cpf, nome, movimentacao_ids) |

**Evidências:** reutilizar `match_evidencia` na movimentação canônica com tipos novos:

| Tipo | Uso |
|------|-----|
| `CRUZAMENTO_PDF` | Par PIX↔completo, detalhe com ids |
| `CADASTRO_UF` | CPF/nome bate `pessoa_*` |
| `EXTRATO_PIX` / `EXTRATO_COMPLETO` | Referência arquivo |
| `IA_CRUZAMENTO` | Kimi confirmou par ambíguo |

**`movimentacao` (alteração leve)**

- `movimentacao_canonica_id` uuid nullable — linha absorvida após merge

---

## 5. Algoritmo de candidatos (regras)

### 5.1 Classificação de arquivo

Heurística por nome (`/pix/i`) ou proporção de linhas sem CPF na descrição → papel `PIX` vs `COMPLETO`.

### 5.2 Par cross-PDF

Dois movimentos (arquivos diferentes) candidatos se:

1. Mesma `data_movimento`, `valor`, `direcao` (**obrigatório**), e
2. Pelo menos um:
   - Mesmo CPF/CNPJ extraído de `descricao_raw`, ou
   - `normalizeName(descricao_pix) === normalizeName(nome)` e nome único no cadastro UF, ou
   - CPF só no completo + nome PIX igual ao `pessoa_fisica.nome` do CPF

### 5.3 Score composto (exemplo)

| Sinal | Confiança base |
|-------|----------------|
| CPF igual nos dois + cadastro UF | 0.95 |
| CPF só completo + data/valor/direção + nome PIX = cadastro | 0.90 |
| Só data/valor/direção + `NOME_CADASTRO` único | 0.80 |
| Só data/valor/direção, nomes parecidos mas homônimo possível | 0.55 → Kimi |
| Sem par PDF, mas CPF na linha + cadastro | 0.85 (evento único) |

**Cap:** score IA ≤ 0.85 até aprovação humana (alinha piloto fluxo prestação).

### 5.4 Kimi (ambíguos)

Entrada: até 2 trechos `descricao_raw`, metadados, candidatos cadastro (máx. 5 CPFs por nome fuzzy futuro — v1 só exatos).

Saída: `{ mesmo_evento, confianca, pessoa_documento, evidencias[] }` — mesma forma do match por movimentação.

**Não** reextrair PDF na consolidação (custo/latência já pagos na ingestão).

---

## 6. UI — Consolidação

### 6.1 Wizard

- Checkbox: **Consolidar extratos (PIX + completo, etc.)**
- Tooltip: importar cadastro da UF antes; cruza PDFs e mostra confiança para revisão

### 6.2 Tela `/prestacao/[sessaoId]/consolidacao`

| Zona | Conteúdo |
|------|----------|
| Alerta | Se cadastro UF vazio: “Importe pessoas em Cadastro (BA)…” |
| Toolbar | Filtros; Aprovar selecionados (≥0.85 + CPF cadastro); Ir ao kanban |
| Tabela | Evento: data, valor, direção, pessoa, **barra confiança**, chips |
| Expandir | PIX vs completo lado a lado; evidências; Aprovar / Rejeitar |
| Lateral | Outras hipóteses (outro CPF, outro par) |

**Referências:** link `arquivo_ingestao`, trecho descrição, link `/pessoas?cpf=`, badge `NOME_CADASTRO` vs `CPF_CADASTRO`.

### 6.3 Submit progress

Step **Consolidar** entre upload e kanban quando flag ativa (pode ser rápido se só regras).

### 6.4 Redirect

- `consolidar && ≥2 PDF` → consolidação
- Senão → kanban (link “Abrir consolidação” se ≥2 PDF depois)

---

## 7. Aprovação e merge

1. Escolher movimentação **canônica** (preferir `COMPLETO` com CPF na descrição).
2. Enriquecer `descricao_raw` e vínculo PF/PJ (cadastro vence sobre stub).
3. Demais linhas: `movimentacao_canonica_id` + status `REJEITADO` ou flag absorvida (auditoria).
4. `applyDeterministicMatch` + `applyAiMatchToMovimentacao` na canônica.
5. `confianca_global` = `consolidacao_evento.confianca`.
6. `rematchPendingMovimentacoes(uf, exercicio)` se cadastro enriquecido.

**Rejeitar:** mantém cards separados; evento `REJEITADO`; não repropõe na sessão.

---

## 8. APIs

| Método | Rota | Notas |
|--------|------|-------|
| POST | `/api/prestacao/sessoes` | Body: `consolidarExtratos?: boolean` |
| POST | `/api/prestacao/sessoes/:id/consolidacao/run` | Gera/recalcula eventos (idempotente) |
| GET | `/api/prestacao/sessoes/:id/consolidacao` | Lista eventos + linhas + hipóteses |
| POST | `/api/prestacao/sessoes/:id/consolidacao/eventos/:eid/aprovar` | Merge |
| POST | `/api/prestacao/sessoes/:id/consolidacao/eventos/:eid/rejeitar` | |
| POST | `/api/prestacao/sessoes/:id/consolidacao/aprovar-lote` | Com limiar + modal |

---

## 9. Erros e limites

| Caso | Comportamento |
|------|----------------|
| Flag consolidar + 1 PDF | Aviso; kanban direto |
| Ingest PDF falhou | Eventos só para movimentações OK |
| IA consolidação falha | Eventos só regras; chip “IA indisponível” |
| Homônimo no cadastro | Sem auto-vínculo; hipótese lateral |
| XLSX pessoas no upload extrato | Wizard valida: rejeitar ou avisar “use Cadastro” |

---

## 10. Testes

| Teste | Fixture / método |
|-------|------------------|
| Par PIX+completo mesma tx | Movimentações mock: nome-only + mesma data/valor com CPF |
| Score CPF completo > só nome | Unit `candidates.ts` |
| Aprovar → 1 card kanban | Integration DB |
| Cadastro BA necessário para nome PIX | Sem PF: confiança baixa; com PF: `NOME_CADASTRO` |
| Não re-chamar OpenRouter PDF | Spy: consolidação só `match/ai` opcional |
| Regressão ingest | `pnpm --filter @spc-up/core test` |

E2E manual checklist (doc descobertas §11) + passo consolidação.

---

## 11. Fora de escopo v1

- Fuzzy nome (Levenshtein)
- OCR local
- Consolidar OFX + PDF
- Auto-`CONFIRMADO` sem humano
- Cadastro particionado por UF no schema

---

## 12. Referências

- Descobertas teste: `2026-05-26-documentos-teste-ingestao-descobertas.md`
- Código ingest/match: `packages/core/src/ingest/pdf.ts`, `match/rules.ts`, `ingest/pdf-split.ts`
