# Especificação de Design: NotebookLM — múltiplos PDFs por sessão

## 1. Contexto e problema

Sessões com `consolidarExtratos=true` e dois ou mais extratos PDF dependem de movimentações atribuídas ao `arquivo_ingestao_id` correto para a consolidação cruzar linhas entre documentos.

**Bug atual** (`packages/core/src/prestacao/process-sessao-notebooklm.ts`):

1. Todos os PDFs pendentes são enviados ao notebook.
2. Uma única `queryNotebook` extrai transações de todos os extratos.
3. Todas as movimentações são gravadas com `arquivoIngestaoId: processedSucessfully[0].arquivoId`.
4. O segundo PDF é marcado `CONCLUIDO` com `movimentacoes_criadas = 0`.

**Evidência:** sessão `037c5d96-ef18-4824-bd2b-1869971c6903` — 2 PDFs `CONCLUIDO`, 27 movimentações só no primeiro; 0 eventos de consolidação com linhas de ambos os extratos.

**Decisão de produto:** manter NotebookLM como pipeline padrão (`USE_NOTEBOOKLM !== "false"`) e corrigir o fluxo NLM (Abordagem 1: query por PDF).

## 2. Objetivo

Para cada PDF pendente da sessão:

- Executar uma query NotebookLM escopada àquele arquivo.
- Persistir movimentações com o `arquivoIngestaoId` correspondente.
- Reportar `movimentacoes_criadas` por arquivo no `ProcessSessaoResult`.

A consolidação (`consolidateSession`) permanece inalterada e roda uma vez ao final, quando houver movimentações de dois ou mais PDFs.

## 3. Arquitetura e fluxo de dados

```
processSessaoWithNotebookLM
  ├─ getOrCreateNotebook + syncCandidateFolder + syncRulesFolder  (inalterado)
  ├─ listPendingPdfArquivos(sessaoId)                            (novo filtro .pdf)
  ├─ Fase upload (por PDF):
  │    └─ uploadFileToNotebook(notebookId, tmpPath)
  ├─ Fase extração (por PDF com upload OK):
  │    ├─ queryNotebook(notebookId, buildPrompt(nomeArquivo))
  │    ├─ parse JSON + validateBalanceConsistency
  │    └─ persistTransactionsForArquivo(arquivoId, transacoes)
  └─ consolidateSession(sessaoId)                                 (inalterado, 1× no final)
```

**Cadastro e regras** continuam no notebook compartilhado (UF/exercício). Cada query de extrato referencia apenas um `nomeArquivo`, mas pode cruzar candidatos e regras SPCA dos demais sources.

## 4. Alterações por componente

### 4.1. Filtro de arquivos pendentes

Alinhar ao pipeline tradicional (`listPendingPdfArquivos` em `process-sessao.ts`):

- Selecionar `arquivo_ingestao` com status `PENDENTE` ou `PROCESSANDO` **e** `nome_arquivo` terminando em `.pdf` (case-insensitive).
- Arquivos não-PDF pendentes na mesma sessão não entram neste fluxo NLM (já tratados no upload por `ingestFileBuffer`).

### 4.2. Prompt por extrato

Extrair `NOTEBOOKLM_QUERY_PROMPT` para função exportável ou interna:

```ts
function buildNotebookLmExtratoPrompt(nomeArquivo: string): string
```

Inserir no início do prompt (após a introdução):

> Analise **apenas** o extrato bancário cujo nome de arquivo no notebook é exatamente: `{nomeArquivo}`. Não inclua transações de outros extratos presentes neste notebook.

O restante do prompt (campos SPCA, tabela de códigos, formato JSON) permanece igual.

### 4.3. Loop query → persist

Substituir o bloco único `queryNotebook` + loop de insert por:

```ts
for (const arq of processedSucessfully) {
  const res = await queryNotebook(notebookId, buildNotebookLmExtratoPrompt(arq.nome));
  // parse, validate saldos → avisos com prefixo do arquivo
  const created = await persistNotebookLmTransactions(db, {
    arquivoIngestaoId: arq.arquivoId,
    sessaoId,
  }, payload, { uf, exercicio, prestadorBase, allPFs, allPJs });
  arq.movimentacoes_criadas = created;
  totalMovs += created;
  await db.update(arquivoIngestao).set({ status: CONCLUIDO }).where(eq(id, arq.arquivoId));
}
```

**Refatoração:** extrair de `process-sessao-notebooklm.ts` a lógica de insert de movimentação + `movimentacao_spca` + match de pessoa para `persistNotebookLmTransactions` (função interna ao arquivo, sem novo módulo).

Remover:

- `arquivoIngestaoId: processedSucessfully[0].arquivoId`
- Atribuição de `movimentacoes_criadas` só no índice 0.

### 4.4. Tratamento de erros

| Falha | Comportamento |
|-------|----------------|
| Upload do PDF | `arquivo` → `ERRO`, `erro` no result; não entra em `processedSucessfully` |
| Query ou parse JSON de um PDF | `arquivo` → `ERRO` com mensagem; demais PDFs já processados permanecem `CONCLUIDO` |
| PDF com 0 transações | `CONCLUIDO`, `movimentacoes_criadas: 0`; aviso opcional no array `avisos` |
| Inconsistência de saldos | Aviso em `avisos` com prefixo `[{nomeArquivo}]` |
| `onConflictDoNothing` (hash duplicado entre extratos) | Comportamento atual mantido — esperado na consolidação |

Se **nenhum** PDF tiver upload bem-sucedido, não executar queries. Se todos falharem na query, `movimentacoesTotal = 0` e consolidação pode retornar `NO_MOVIMENTACOES`.

### 4.5. Interface Web / CLI

Sem mudança de contrato de API. `ProcessSessaoResult.arquivos[]` passará a refletir contagem correta por PDF.

Mensagem de progresso no hook `use-prestacao-submit` continua genérica (“Processando com NotebookLM…”). Melhoria de progresso por PDF fica fora do escopo desta spec.

### 4.6. Consolidação

Nenhuma alteração em `consolidateSession`. Com movimentações em dois `arquivo_ingestao_id`, `buildConsolidacaoCandidates` poderá gerar eventos com linhas de extratos distintos.

## 5. Testes

Arquivo: `packages/core/src/prestacao/process-sessao-notebooklm.test.ts`

| Caso | Assertiva |
|------|-----------|
| 1 PDF (regressão) | 1× `queryNotebook`, `arquivoIngestaoId` correto no insert |
| 2 PDFs | 2× `queryNotebook` com prompts contendo cada `nomeArquivo`; inserts com `arquivoIngestaoId` distintos; `movimentacoes_criadas` por arquivo |
| Falha na query do 2º PDF | 1º `CONCLUIDO` com movs; 2º com `erro` |
| Filtro `.pdf` | Arquivo `.xlsx` pendente ignorado no loop NLM |

Mocks existentes de `queryNotebook` devem retornar payloads distintos por chamada (`mockResolvedValueOnce`).

## 6. Fora de escopo

- Progresso granular na UI (N de M PDFs).
- Query por `source_id` do CLI (pode ser otimização futura se o `nlm` expuser filtro por source).
- Fallback automático para OpenRouter em multi-PDF.
- Reprocessamento da sessão `037c5d96-…` em produção (ação manual do usuário após deploy).

## 7. Critérios de aceite

1. Sessão com 2 PDFs e `consolidarExtratos=true`: cada PDF com `movimentacoes_criadas > 0` quando o extrato tem lançamentos.
2. `movimentacao.arquivo_ingestao_id` distribuído entre os IDs dos PDFs enviados.
3. Consolidação gera pelo menos um evento com linhas de dois `nome_arquivo` distintos (quando houver pares candidatos nos extratos).
4. Testes unitários acima passam em `packages/core`.

## 8. Plano de verificação manual

1. Reenviar os dois extratos da sessão de teste (ou nova sessão BA 2025).
2. Confirmar no banco: `GROUP BY arquivo_ingestao_id` com contagens em ambos os PDFs.
3. Abrir tela de consolidação: coluna “Documento (PDF)” mostra os dois arquivos em eventos cruzados.
