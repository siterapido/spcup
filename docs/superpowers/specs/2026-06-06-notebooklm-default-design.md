# Especificação de Design: NotebookLM como Padrão por Código e Configuração

## 1. Introdução e Objetivo

Esta especificação define as alterações necessárias para tornar o **NotebookLM** o mecanismo padrão de extração e processamento de arquivos (extratos/regras/cadastro) no sistema SPC-UP, tanto na interface Web quanto no CLI, desativando chamadas ao OpenRouter por padrão e garantindo segurança operacional sem custos inesperados.

## 2. Abordagem de Integração

A opção escolhida foi a **Abordagem 1 (Forçar padrão NotebookLM globalmente)**:
- O processamento central de sessões prioriza o NotebookLM por padrão, a menos que explicitamente configurado com `USE_NOTEBOOKLM=false`.
- A API de upload na web retorna para a interface a sinalização de uso do NotebookLM de forma alinhada com as configurações padrão.

## 3. Detalhamento das Alterações

### 3.1. Core (`packages/core/src/prestacao/process-sessao.ts`)
Modificar a função `processSessaoPdfArquivos`:
- Atualmente verifica se `process.env.USE_NOTEBOOKLM === "true"`.
- Alterar para verificar se `process.env.USE_NOTEBOOKLM !== "false"`.
- Assim, se a variável não estiver definida, ou se estiver ativa, o sistema usará o NotebookLM por padrão.

### 3.2. Web API (`apps/web/app/api/prestacao/sessoes/[id]/upload/route.ts`)
Modificar os locais onde `useNotebookLm` é retornado para a interface:
- Alterar de `process.env.USE_NOTEBOOKLM === "true"` para `process.env.USE_NOTEBOOKLM !== "false"`.
- Isso garante que a interface Web execute o pipeline integrado de processamento do NotebookLM.

### 3.3. Configuração de Variáveis de Ambiente (`.env.example`)
Garantir que os exemplos mostrem NotebookLM ativado e OpenRouter desativado:
- `USE_NOTEBOOKLM=true` (padrão)
- `DISABLE_OPENROUTER=true` (padrão)

## 4. Plano de Verificação

- **Verificação local**: Executar testes unitários do processamento de sessões para garantir que a lógica padrão de direcionamento ao NotebookLM se comporta conforme esperado sob diferentes valores de `USE_NOTEBOOKLM`.
