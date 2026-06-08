# Especificação de Design: Desativação do OpenRouter por Padrão e Integração com NotebookLM

## 1. Introdução e Objetivo

Esta especificação define as alterações necessárias para desativar o uso de APIs via OpenRouter (Gemini, Kimi) por padrão no sistema SPC-UP. O processamento de IA passa a ser realizado exclusivamente via **NotebookLM** offline (usando o CLI `nlm` local) quando a flag correspondente estiver ativa, enquanto os outros módulos que dependiam do OpenRouter devem adotar fallbacks locais determinísticos e heurísticos (como Levenshtein) ou avisar que a funcionalidade está desativada.

## 2. Arquitetura e Configurações (.env)

Será introduzida uma flag explícita no arquivo `.env.example` e `.env.local`:

```ini
# Desativa todas as chamadas de rede para o OpenRouter
DISABLE_OPENROUTER=true
```

Se `DISABLE_OPENROUTER=true` ou `OPENROUTER_API_KEY` estiver ausente/em branco:
- Todas as chamadas para as funções do pacote `@spc-up/core` que usavam OpenRouter falharão graciosamente ou seguirão rotas de fallback local.

## 3. Impacto e Comportamento por Módulo

### 3.1. Ingestão de Extratos PDF (`ingest/pipeline.ts`)
- Se `USE_NOTEBOOKLM=true`: O fluxo continua operando via CLI `nlm` normalmente (upload do PDF + regras + cadastro ao notebook, query global e estruturação em JSON).
- Se `USE_NOTEBOOKLM=false` (ou ausente) e `DISABLE_OPENROUTER=true`:
  - A tentativa de ingestão de PDF lança um erro amigável informando que a extração tradicional via OpenRouter está desativada. Deve-se configurar `USE_NOTEBOOKLM=true` ou habilitar a chave do OpenRouter.

### 3.2. Conciliação e Match (`enrichAmbiguousWithAi`)
- O arquivo `packages/core/src/consolidacao/ai.ts` verifica `DISABLE_OPENROUTER` ou a ausência da chave.
- Se o OpenRouter estiver desativado, a função `enrichAmbiguousWithAi` retornará os rascunhos de conciliação originais imediatamente sem modificação, confiando apenas nas regras determinísticas locais (Levenshtein e cruzamento de CPF/CNPJ offline).

### 3.3. Mapeamento de Colunas do Extrato (`extrato-column-map.ts`)
- Mapeamento assistido por IA de colunas do extrato bancário utilizará regras locais baseadas em dicionários de termos frequentes (ex: "PIX", "TED", "DOC", "TAR", "DEPOSITO") ao invés de prompts via OpenRouter, evitando falhas de processamento offline.

### 3.4. API Web de Reprocessamento (`reprocessar-ia/route.ts`)
- O endpoint `/api/movimentacoes/[id]/reprocessar-ia` retornará um status `400 Bad Request` informando que a IA do OpenRouter está desativada na instância atual, impedindo travamentos ou erros 503 inesperados.

## 4. Plano de Testes e Ajustes

- Adaptar os testes de `openrouter` para simular cenários com `DISABLE_OPENROUTER=true`.
- Garantir que as suítes de testes de pipeline e conciliação passem localmente sem requerer chaves de API externas.
