# Cadastro PF/PJ — Importação, perfil e vínculo a movimentações (Design)

**Data:** 2026-05-26  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado para implementação  
**Relacionado:** [2026-05-25-spc-up-prestacao-contas-design.md](./2026-05-25-spc-up-prestacao-contas-design.md)

---

## 1. Resumo executivo

Cadastro nacional de **pessoas físicas (CPF)** e **jurídicas (CNPJ)** como identificadores das transações (`movimentacao.pessoa_fisica_id` / `pessoa_juridica_id`), com:

1. **Cadastro manual** na web (fluxo principal).
2. **Importação em lote** via planilha única (Excel/CSV) com colunas mínimas.
3. **Perfil** com histórico de movimentações em **todas as UFs e exercícios**.
4. **Re-match automático** das movimentações pendentes da **UF/exercício de contexto** após cadastro/importação bem-sucedida.
5. **Conflitos de nome** bloqueados para revisão manual (não sobrescrever silenciosamente).

Reutiliza tabelas `pessoa_fisica` e `pessoa_juridica` existentes e o motor `applyDeterministicMatch` em `packages/core/src/match/rules.ts`.

---

## 2. Decisões de produto (registro)

| Tema | Decisão |
|------|---------|
| Entrada de dados | Planilha única (tipo + documento + nome) **e** cadastro manual na web |
| Colunas da planilha (v1) | Apenas `tipo`, `documento`, `nome` |
| Pós-cadastro / pós-import | Re-match automático das pendentes da **UF/exercício atual** com CPF/CNPJ na descrição |
| Conflito de nome | Bloquear linha/cadastro; fila de revisão manual |
| Perfil — histórico | Todas as movimentações vinculadas, todas UFs e exercícios |
| Escopo v1 fora | CLI dedicada, `titulo_eleitor`/`aliases` na planilha, RBAC por UF, merge de duplicatas |

---

## 3. Contexto no sistema atual

- **Schema:** `pessoa_fisica` (cpf único, nome), `pessoa_juridica` (cnpj único, razao_social); `movimentacao` com FK opcional para uma das duas.
- **Match na ingestão:** extrai CPF/CNPJ de `descricao_raw`; se não existe cadastro, cria stub (`DESCONHECIDO` / `DESCONHECIDA`).
- **Export SPCA:** exige pessoa vinculada em aplicação/origem conforme módulo.
- **Gap:** não há UI/API de cadastro em lote, fila de conflitos, perfil nem re-match dirigido após enriquecer cadastro.

---

## 4. Arquitetura

```text
[Web: /pessoas/*] ──► API Next.js (apps/web/app/api/pessoas/*)
                              │
                              ▼
                    @spc-up/core/cadastro
                    (parse, upsert, conflitos, rematch)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   pessoa_fisica      pessoa_juridica      cadastro_conflito (nova)
          │                   │
          └─────────► movimentacao
                              ▲
                    applyDeterministicMatch (por movimentação)
```

**Princípio:** cadastro é fonte da verdade de documento + nome; transações referenciam por FK; histórico é derivado (sem tabela `historico`).

**Abordagem escolhida:** serviço em `packages/core` + APIs REST + páginas Next.js (não job assíncrono com staging na v1).

---

## 5. Modelo de dados

### 5.1 Tabelas existentes (sem alteração de colunas na v1)

- `pessoa_fisica`: `cpf`, `nome`, `titulo_eleitor?`, `aliases?`
- `pessoa_juridica`: `cnpj`, `razao_social`, `aliases?`

### 5.2 Nova tabela: `cadastro_conflito`

| Coluna | Tipo | Notas |
|--------|------|-------|
| `id` | uuid PK | |
| `tipo` | varchar(2) | `PF` \| `PJ` |
| `documento` | varchar(14) | CPF 11 ou CNPJ 14, normalizado |
| `nome_existente` | varchar(255) | Nome/razão no banco no momento do conflito |
| `nome_proposto` | varchar(255) | Nome/razão da planilha ou formulário |
| `origem` | varchar(10) | `IMPORT` \| `MANUAL` |
| `status` | varchar(20) | `PENDENTE` → `RESOLVIDO` \| `IGNORADO` |
| `resolucao` | varchar(20)? | `MANTER_NOME` \| `ATUALIZAR_NOME` quando `RESOLVIDO` |
| `uf_contexto` | varchar(2) | UF usada no re-match pós-resolução |
| `exercicio_contexto` | integer | Exercício usado no re-match pós-resolução |
| `pessoa_fisica_id` | uuid? FK | Preenchido se `tipo=PF` |
| `pessoa_juridica_id` | uuid? FK | Preenchido se `tipo=PJ` |
| `created_at` | timestamptz | |
| `resolved_at` | timestamptz? | |

Índices: `(status)` onde `PENDENTE`; `(documento, tipo)`.

---

## 6. Regras de negócio — upsert de pessoa

Normalização: `normalizeCpf` / `normalizeCnpj`, `normalizeName` (`packages/core/src/normalize.ts`).

Para cada proposta `(tipo, documento, nome)`:

| Situação | Ação |
|----------|------|
| Documento não existe | `INSERT` com nome normalizado |
| Existe e nome normalizado **igual** | Sucesso (no-op) |
| Existe, nome é stub (`DESCONHECIDO` / `DESCONHECIDA`) | `UPDATE` nome/razão (enriquecimento, **não** é conflito) |
| Existe, nome real **diferente** do proposto | **Não alterar**; criar `cadastro_conflito` com `status=PENDENTE` |

**Cadastro manual:** mesmas regras; resposta HTTP 409 com referência ao conflito quando aplicável.

---

## 7. Importação em lote

### 7.1 Formato

- **Excel:** primeira planilha (`.xlsx`, `.xls`).
- **CSV:** UTF-8, separador `,` ou `;` (detectar na primeira linha).
- **Cabeçalhos obrigatórios** (case-insensitive): `tipo`, `documento`, `nome`.

### 7.2 Valores de `tipo`

Aceitar: `PF`, `PJ`, `FISICA`, `JURIDICA`, `PESSOA_FISICA`, `PESSOA_JURIDICA` (mapear para PF/PJ).

### 7.3 Processamento

- Linha a linha; falha em uma linha **não** aborta o arquivo inteiro.
- Resposta:

```json
{
  "inseridos": 0,
  "atualizados": 0,
  "ignorados": 0,
  "conflitos": 0,
  "erros": [{ "linha": 2, "motivo": "CPF inválido" }]
}
```

### 7.4 Pós-import

Se `inseridos + atualizados > 0`, executar `rematchPendingMovimentacoes(db, uf, exercicio)` (parâmetros do request).

---

## 8. Re-match automático

### 8.1 Quando disparar

- Após import com pelo menos um insert/update de nome (não só no-ops).
- Após cadastro manual bem-sucedido (insert ou update de stub).
- Após resolver conflito com `resolucao=ATUALIZAR_NOME`.

### 8.2 Critério de seleção de movimentações

Na UF e exercício de contexto:

- `status` ∈ `{ RASCUNHO, PENDENTE_REVISAO }` (constantes em `MOVIMENTACAO_STATUS`).
- E (`pessoa_fisica_id` IS NULL AND `pessoa_juridica_id` IS NULL **OU** pessoa vinculada é stub).
- E `extractDocumentCandidates(descricao_raw)` retorna ao menos um documento.

Para cada id selecionado: `applyDeterministicMatch(db, id)`.

### 8.3 Melhoria de confiança (mesma entrega)

Quando o vínculo usar pessoa com nome **não stub**, registrar evidência `CPF_CADASTRO` ou `CNPJ_CADASTRO` com peso `DEFAULT_WEIGHTS.CPF_EXATO` (0.45), em substituição ou complemento à evidência só de extração na descrição — alinhado à matriz do spec principal.

---

## 9. Resolução de conflitos

**UI:** `/pessoas/conflitos` — lista `PENDENTE` com documento, nomes lado a lado, origem, contexto UF/exercício.

**Ações:**

| Resolução | Efeito |
|-----------|--------|
| `MANTER_NOME` | Fecha conflito; cadastro inalterado; sem re-match obrigatório |
| `ATUALIZAR_NOME` | `UPDATE` nome/razão para `nome_proposto`; `rematchPendingMovimentacoes(uf_contexto, exercicio_contexto)` |
| `IGNORADO` | Descarta proposta sem alterar cadastro |

---

## 10. Interface web

| Rota | Função |
|------|--------|
| `/pessoas` | Listagem; busca por nome ou documento; contagem de movimentações |
| `/pessoas/nova` | Formulário PF/PJ; seletor UF + exercício (contexto re-match) |
| `/pessoas/importar` | Upload planilha + UF + exercício |
| `/pessoas/conflitos` | Fila de revisão |
| `/pessoas/[id]` | Perfil PF ou PJ (resolver tipo por rota ou query `?tipo=pf`) |

### 10.1 Perfil

- Cabeçalho: tipo, documento (mascarado na UI: ex. `***.456.789-**` / `**.223.330/0001-**`), nome, datas de cadastro.
- Resumo: total de movimentações; opcionalmente contagem por UF e por exercício.
- Tabela histórico: data, UF, exercício, direção, valor, status, link para revisão em `/movimentacoes` com query params.

### 10.2 Navegação

Link no layout principal (header ou home) para **Pessoas (PF/PJ)**.

---

## 11. APIs

Todas exigem sessão autenticada (`requireSession`), mesmo padrão de `/api/movimentacoes`.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/pessoas?q=&tipo=PF\|PJ` | Listagem paginada |
| POST | `/api/pessoas` | Body: `{ tipo, documento, nome, uf, exercicio }` |
| GET | `/api/pessoas/[id]?tipo=pf\|pj` | Detalhe do cadastro |
| GET | `/api/pessoas/[id]/movimentacoes` | Histórico nacional |
| POST | `/api/pessoas/import` | `multipart`: arquivo + `uf` + `exercicio` |
| GET | `/api/pessoas/conflitos?status=PENDENTE` | Fila |
| POST | `/api/pessoas/conflitos/[id]/resolver` | Body: `{ resolucao }` |

**Erros:**

- Planilha sem colunas obrigatórias → 400.
- Conflito no manual → 409 + `conflitoId`.
- Documento inválido na linha → acumulado em `erros[]`, não 400 global.

---

## 12. Pacote `packages/core`

Novo módulo exportado em `@spc-up/core`:

| Função | Responsabilidade |
|--------|------------------|
| `parseCadastroSpreadsheet(buffer)` | Retorna linhas tipadas |
| `upsertPessoa(db, row, ctx)` | Regras da seção 6 |
| `importCadastroBatch(db, rows, uf, exercicio)` | Orquestra upsert + contadores |
| `rematchPendingMovimentacoes(db, uf, exercicio)` | Seção 8 |
| `resolveCadastroConflito(db, id, resolucao)` | Seção 9 |
| `listPessoaMovimentacoes(db, pessoaId, tipo)` | Histórico nacional |

Testes Vitest: parse, stub update, conflito, rematch parcial, resolver conflito.

---

## 13. Migração

- Drizzle migration: `cadastro_conflito` + índices + FKs opcionais para `pessoa_*`.
- Sem seed obrigatório.

---

## 14. Segurança e LGPD

- CPF/CNPJ completos apenas para usuários autenticados; mascarar em listagens onde possível.
- Logs de API não devem registrar documento completo em nível INFO.
- Conflitos armazenam nomes propostos (dado pessoável); mesma política de retenção do cadastro principal.

---

## 15. Critérios de aceite

1. Importar planilha com 10 PF novos → registros em `pessoa_fisica`; movimentações pendentes da UF/exercício com CPF na descrição vinculadas após import.
2. Importar linha com CPF existente e nome diferente (não stub) → `cadastro_conflito` PENDENTE; cadastro não alterado.
3. Atualizar stub via import → nome real; re-match vincula movimentações que tinham só stub.
4. Cadastro manual com conflito → 409 e registro na fila.
5. Perfil exibe movimentações de múltiplas UFs/exercícios na mesma tela.
6. Resolver conflito com `ATUALIZAR_NOME` → nome atualizado e re-match no contexto salvo.
7. `pnpm test` passa nos novos testes de cadastro e regressão de match.

---

## 16. Fora de escopo (v1)

- Comando CLI `spc-up cadastro import`
- Colunas `titulo_eleitor`, `aliases`, `observacao` na planilha
- Edição inline de documento (CPF/CNPJ imutável após criação)
- RBAC por UF; auditoria dedicada além de `cadastro_conflito` timestamps
- Re-match global (todas UFs) em um único clique

---

## 17. Próximo passo

Após revisão deste documento: plano de implementação em `docs/superpowers/plans/2026-05-26-cadastro-pf-pj.md` (skill writing-plans).
