# Remetente/Destinatário — substitui Nome (Design)

**Data:** 2026-06-08  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado (grill-me 2026-06-08)  
**Relacionado:**
- [2026-06-08-planilha-nome-contraparte-design.md](./2026-06-08-planilha-nome-contraparte-design.md) (substituído)
- [2026-06-02-pdf-extrato-mapeamento-colunas-design.md](./2026-06-02-pdf-extrato-mapeamento-colunas-design.md)
- [2026-06-08-extrato-column-map-notebooklm-design.md](./2026-06-08-extrato-column-map-notebooklm-design.md)

---

## 1. Resumo

Renomear conceito **Nome/contraparte** para **Remetente/Destinatário** em todo o produto: mapeamento de colunas PDF, schema IA, banco, API, planilha. Valor vem **somente** da coluna mapeada no PDF ou edição manual — sem derivação de histórico/PIX. Deploy inclui wipe do domínio operacional e migration de coluna.

---

## 2. Decisões (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Layout PDF | Uma coluna "Remetente/Destinatário" |
| 2 | Célula | Um nome por linha |
| 3 | Escopo | Produto inteiro |
| 4 | vs cadastro | C — indicador visual + auto-vínculo PF/PJ único |
| 5 | Campo mapa | `remetente_destinatario` canônico; `nome` rejeitado |
| 6 | Schema IA | `remetente_destinatario` (sem `nome`) |
| 7 | Banco | `nome_contraparte` → `remetente_destinatario` |
| 8 | API/planilha | Breaking — só `remetenteDestinatario` |
| 9 | Parse IA | Só `remetente_destinatario`; sem fallback `nome` |
| 10 | Mapas antigos | Rejeita `campo: "nome"` — remapear no wizard |
| 11 | Fallback origens | **Não** — só coluna ou edição manual |
| 12 | OFX / sem mapa | Sempre null até editar |
| 13 | Dados existentes | Wipe domínio (não reprocess em lote) |
| 14 | Wipe preserva | `usuario`, `diretorio_estadual`, `diretorio_municipal` |
| 15 | Wipe execução | Script idempotente + `ALLOW_DOMAIN_WIPE=1` |

---

## 3. Modelo de dados

```sql
ALTER TABLE movimentacao RENAME COLUMN nome_contraparte TO remetente_destinatario;
ALTER TABLE consolidacao_evento RENAME COLUMN nome_contraparte TO remetente_destinatario;
```

| Campo | Semântica |
|-------|-----------|
| `NULL` | Coluna vazia na extração; exibir `—` na planilha |
| não-`NULL` | Valor da coluna Remetente/Destinatário ou override do operador |

**Removido:** `nomeDerivado`, `deriveNomeContraparte`, `resolveNomeEffective` no fluxo de planilha/ingest.

---

## 4. Mapeamento de colunas

- `EXTRATO_COLUMN_MAP_CAMPOS_PADRAO`: substituir `nome` por `remetente_destinatario`
- `EXTRATO_SESSION_REQUIRED_CAMPOS`: `["remetente_destinatario", "historico", "documento"]`
- `parseExtratoColumnMap`: retorna `null` se qualquer entrada tiver `campo === "nome"`
- Auto-map keywords: `remetente`, `destinatario`, `remetente/destinatario`, `favorecido`, etc.
- Label UI: **Remetente/Destinatário**

---

## 5. Schema IA

### OpenRouter (`EXTRATO_TRANSACTION_ITEM_SCHEMA`)

- Campo `nome` → `remetente_destinatario`
- Prompts e exemplos JSON atualizados
- Ingest `pdf.ts`: ler só `item.remetente_destinatario`; gravar direto (sem `nomeContraparteFromDescricao`)

### NotebookLM

- Adicionar `remetente_destinatario` ao objeto de transação no prompt
- `persistNotebookLmTransactions`: gravar coluna em `movimentacao.remetente_destinatario`
- `nome_candidato` permanece para match cadastro no notebook (distinto da coluna do extrato)

---

## 6. Planilha

| Antes | Depois |
|-------|--------|
| Coluna "Nome" | "Remetente/Destinatário" |
| `PlanilhaLinha.nome` | `remetenteDestinatario` |
| `nomeContraparte` | removido (usar `remetenteDestinatario: string \| null`) |
| `nomeDerivado` | removido |
| Filtro "Sem nome" | "Sem remetente/destinatário" (`semRemetenteDestinatario`) |
| `PATCH { nomeContraparte }` | `PATCH { remetenteDestinatario }` |

Comparação cadastro: manter `compararNomeCadastro(extraido, pessoa.nome)` — sem renomear helper.

Auto-vínculo: `findUniquePessoaByNome` quando `remetenteDestinatario` preenchido e PF/PJ vazio.

---

## 7. Wipe (`scripts/wipe-domain.ts`)

Guard: `process.env.ALLOW_DOMAIN_WIPE === "1"`.

Truncate (ordem FK):

```
cadastro_conflito,
consolidacao_hipotese,
consolidacao_linha,
consolidacao_evento,
match_evidencia,
movimentacao_spca,
doacao_financeira_link,
movimentacao,
ingestao_linha_pendente,
ingestao_pagina,
arquivo_ingestao,
sessao_prestacao,
conta_bancaria,
pessoa_fisica,
pessoa_juridica
```

**Não truncar:** `usuario`, `diretorio_estadual`, `diretorio_municipal`.

---

## 8. Critérios de aceite

1. Wizard rejeita mapa com `campo: "nome"`; aceita `remetente_destinatario`
2. IA retorna `remetente_destinatario`; ingest grava na coluna DB
3. Planilha exibe coluna "Remetente/Destinatário"; sem valor derivado de origens
4. Bolinha verde/âmbar quando PF/PJ vinculado
5. `ALLOW_DOMAIN_WIPE=1 pnpm exec tsx scripts/wipe-domain.ts` limpa domínio sem apagar login/UF
6. `pnpm --filter @spc-up/core test` verde
