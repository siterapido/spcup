# Dedup de hash colapsando transações — extração NotebookLM

Data: 2026-06-08
Status: design aprovado (escopo: somente motor NotebookLM)

## Problema

Na planilha unificada, pouquíssimas linhas chegam à planilha apesar de a IA
extrair muito mais. Exemplo observado (sessão BA/2025):

- `EXTRATO TOTAL JANEIRO.pdf`: 9 criadas + 27 "sem doc." → 36 extraídas.
- `Extrato Jan PIX.pdf`: 0 criadas + 34 "sem doc." → 34 extraídas.
- Badge "Resumo da extração 62" = 27 + 34 + 1 aviso de saldo.

A IA extraiu ~70 linhas; ~61 foram descartadas silenciosamente.

## Causa raiz

O motor ativo é o NotebookLM (`USE_NOTEBOOKLM !== "false"`, default ligado).
Em `persistNotebookLmTransactions`
(`packages/core/src/prestacao/process-sessao-notebooklm.ts`) cada transação é
inserida com `onConflictDoNothing()` contra o índice único parcial
`uq_mov_prestador_exercicio_hash` = `(cnpjPrestador, exercicio, hashMovimento)`
onde `deleted_at IS NULL`.

`computeHashMovimento` (`packages/core/src/ingest/hash.ts`) calcula:

```
sha256(cnpj | exercicio | data | valor | descricaoRaw | direcao | credDev | nrExtratoBancario)
```

No caminho NotebookLM `credDev` e `nrExtratoBancario` ficam vazios, então o hash
depende só de `data | valor | descrição | direção`. Consequências:

1. **Dentro de um extrato:** N créditos "CRED PIX" iguais (mesma data/valor) →
   colidem no hash → só 1 persiste. As demais são transações reais perdidas.
2. **Entre PDFs:** uma linha do extrato PIX idêntica a uma do extrato TOTAL →
   colide → a linha do PIX nunca é persistida (0 criadas).

O ponto 2 é especialmente grave porque a **consolidação** é o local correto para
fundir duplicatas entre PDFs: `buildConsolidacaoCandidates`
(`packages/core/src/consolidacao/candidates.ts`) só pareia movimentações de
arquivos diferentes (`a.arquivoIngestaoId === b.arquivoIngestaoId → continue`,
linha 244) e inclusive trata o caso PIX↔COMPLETO. Como o dedup por hash apaga as
linhas do PIX antes, o cruzamento nunca ocorre.

Ou seja: o dedup está na **camada errada** e destrói justamente o que a
consolidação deveria fundir.

A métrica `linhas_ignoradas_sem_doc = transactions.length - created`
(`buildNotebookLmIngestMetadados`) e seu label "sem doc." na UI
(`apps/web/components/prestacao/planilha-ingestao-resumo.tsx`) são enganosos: o
que conta não é ausência de documento, e sim colisão de hash.

## Solução (Abordagem A — escopo NotebookLM)

Tornar o hash de dedup único por linha dentro do arquivo e distinto entre
arquivos, preservando todas as transações reais e habilitando a consolidação.

### Componente 1 — discriminador opcional em `computeHashMovimento`

`packages/core/src/ingest/hash.ts`

Adicionar um parâmetro opcional `discriminador?: string`, anexado ao final do
payload do hash:

```
payload = [
  cnpjPrestador, exercicio, data, valor, descricaoRaw, direcao,
  credDev ?? "", nrExtratoBancario ?? "",
  discriminador ?? "",
].join("|")
```

Quando `discriminador` é omitido/`""`, o hash é idêntico ao atual — sem
regressão para os demais chamadores.

### Componente 2 — `persistNotebookLmTransactions`

`packages/core/src/prestacao/process-sessao-notebooklm.ts`

Iterar com índice e passar
`discriminador = ${arquivoIngestaoId}|${index}` para `computeHashMovimento`
(index = posição 0-based da transação no array `transactions`).

Efeitos:

- Linhas idênticas repetidas no mesmo extrato → `index` difere → todas persistem.
- Linha igual em PDFs diferentes → `arquivoIngestaoId` difere → não colidem → a
  consolidação faz o cruzamento PIX↔TOTAL como já projetado.
- Idempotência: reprocesso não é fluxo normal (apenas arquivos
  `PENDENTE`/`PROCESSANDO` são processados; ao concluir viram `CONCLUIDO` e são
  filtrados). Se houver reprocesso com a mesma ordem do NotebookLM, os hashes se
  repetem e o dedup continua válido. Ordem divergente em reprocesso é um caso de
  borda aceito (não regride o fluxo normal).

### Componente 3 — métrica/label honesto

- `buildNotebookLmIngestMetadados`: com o fix, `created ≈ transactions.length`,
  então `transactions.length - created` passa a refletir apenas duplicatas reais
  (≈0 no fluxo normal). Renomear a chave para algo fiel (ex.:
  `linhas_duplicadas_ignoradas`) mantendo retrocompatibilidade de leitura.
- UI (`planilha-ingestao-resumo.tsx` + leitura em
  `packages/core/src/planilha/ingestao-resumo.ts`): ajustar o texto "sem doc."
  para refletir o significado real (duplicata), e contar corretamente em
  `countAlertas`.

## Fora de escopo

- Caminho OpenRouter / `persistTransactions` (`ofx.ts`) e `pdf-pagina.ts` — o
  usuário pediu foco só no NotebookLM. O bug latente análogo no fallback fica
  registrado mas não será corrigido agora.
- Prompt/modelo de IA — a extração já traz as linhas.
- Lógica de consolidação — já funciona quando recebe as linhas.
- Schema/migração — o índice único `uq_mov_prestador_exercicio_hash` continua
  válido; muda apenas o valor calculado do hash.

## Verificação (critérios de sucesso)

Testes unitários:

- `computeHashMovimento`:
  - mesma linha com `discriminador` diferente → hashes distintos;
  - mesma linha sem `discriminador` → hash idêntico ao comportamento atual
    (proteção de regressão);
- `persistNotebookLmTransactions`:
  - N transações idênticas (mesma data/valor/descrição/direção) num mesmo
    arquivo → N movimentações criadas (não 1);
  - linha idêntica em dois `arquivoIngestaoId` distintos → 2 movimentações
    criadas (habilita consolidação).

Validação manual:

- Reprocessar a sessão BA/2025 de exemplo e confirmar que o número de linhas na
  planilha sobe de 9 para ~70, e que "sem doc." cai para ~0.
