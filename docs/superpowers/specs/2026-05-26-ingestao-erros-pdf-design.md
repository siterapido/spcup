# Ingestão — erros detalhados e correção PDF — Design

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:** `2026-05-26-pdf-extrato-prestacao-design.md`, `2026-05-26-prestacao-submit-progress-design.md`

---

## 1. Resumo

Corrigir o processamento de PDF de extrato (modelo OpenRouter incorreto), adicionar **logs estruturados** no servidor para falhas de ingestão e expor **mensagens de erro amigáveis** na interface. Comportamento de redirect no wizard: **regra B** — se nenhuma movimentação foi criada e houve falha, permanecer no wizard com erro bloqueante; se houve sucesso parcial, ir ao kanban com aviso.

---

## 2. Decisões de produto

| Tema | Decisão |
|------|---------|
| Redirect após upload | **B**: parcial OK → kanban + aviso; **todos falharam** → erro no wizard, sem redirect |
| Modelo PDF | `OPENROUTER_PDF_MODEL` ou default `anthropic/claude-sonnet-4`; **não** usar `OPENROUTER_MODEL` (Kimi) |
| Mensagens na UI | Português, código interno + texto amigável; detalhe técnico só em log |
| HTTP quando todos falham | **422** com lista `erros[]` tipada |
| HTTP sucesso parcial | **200** com `arquivos` + `erros` |
| Logs | JSON em `console` (info/error) com fase, arquivo, duração, `codigoErro` |

---

## 3. Causa raiz — modelo PDF

`resolveExtratoModel` hoje faz fallback para `process.env.OPENROUTER_MODEL` (ex.: `moonshotai/kimi-k2.6`), usado para match de movimentações, **não** para extração de PDF/visão. Isso contradiz a spec de extrato e explica falhas silenciosas ou erros HTTP da OpenRouter.

**Correção:**

```typescript
options?.model ?? process.env.OPENROUTER_PDF_MODEL ?? "anthropic/claude-sonnet-4"
```

---

## 4. Códigos de erro e mensagens

| `codigo` | Quando | `mensagem` (UI) |
|----------|--------|-----------------|
| `OPENROUTER_NAO_CONFIGURADO` | `OPENROUTER_API_KEY` ausente | Extração de PDF não está configurada no servidor. Contate o administrador. |
| `OPENROUTER_FALHA` | HTTP/timeout/retry esgotado OpenRouter | Não foi possível ler o extrato com IA. Tente novamente em alguns minutos. |
| `PDF_INVALIDO` | `pdf-parse` ou buffer inválido | Arquivo PDF inválido ou corrompido. |
| `PDF_MUITAS_PAGINAS` | `numpages > 3` | Extrato com mais de 3 páginas. Divida o arquivo. |
| `PDF_SEM_TEXTO_E_VISAO_FALHOU` | Texto curto e fallback visão falhou | Não foi possível extrair dados deste PDF (scan ou formato não suportado). |
| `STORAGE_FALHA` | Vercel Blob `put` falhou | Falha ao salvar o arquivo. Tente novamente. |
| `INGESTAO_DESCONHECIDA` | Outros | Erro inesperado no processamento. |

`erroMensagem` em `arquivo_ingestao` continua gravando a mensagem amigável (não o stack).

---

## 5. Logs estruturados

Módulo `packages/core/src/ingest/log.ts`:

```typescript
type IngestLogLevel = "info" | "error";
type IngestFase =
  | "inicio"
  | "pdf_text"
  | "openrouter_text"
  | "openrouter_vision"
  | "filtro_doc"
  | "persist"
  | "match"
  | "concluido";

interface IngestLogFields {
  fase: IngestFase;
  arquivoId?: string;
  sessaoId?: string;
  filename?: string;
  duracaoMs?: number;
  codigoErro?: string;
  causa?: string; // mensagem técnica resumida, só em error
}

function ingestLog(level: IngestLogLevel, fields: IngestLogFields): void;
```

- `info`: marcos de fase com `duracaoMs` quando relevante  
- `error`: inclui `codigoErro`, `causa` (ex.: `OpenRouter HTTP 401`), sem stack completo por padrão  
- Saída: uma linha JSON via `console.log` / `console.error` para Vercel/runtime  

Pontos instrumentados: `ingestPdfExtrato`, `ingestFileBuffer`, `upload/route.ts` (storage).

---

## 6. API — `POST /api/prestacao/sessoes/:id/upload`

### Resposta de sucesso (200)

```typescript
{
  arquivos: Array<{
    nome: string;
    movimentacoes_criadas: number;
    linhas_ignoradas_sem_doc?: number;
  }>;
  erros: Array<{
    nome: string;
    codigo: string;
    mensagem: string;
  }>;
  total_movimentacoes: number;
}
```

### Falha total (422)

Quando `total_movimentacoes === 0` e `erros.length > 0` (e houve tentativa de processar arquivos):

```typescript
{
  error: "Nenhum arquivo foi processado com sucesso.";
  erros: Array<{ nome; codigo; mensagem }>;
}
```

Arquivos com formato inválido antes do ingest continuam em `erros` sem impedir 422 se nada foi ingerido.

---

## 7. UI — wizard e hook

### `usePrestacaoSubmit`

| Condição | Ação |
|----------|------|
| `status === 422` | `phase: error`, etapas upload/ingest em erro, **sem** redirect |
| `200` e `total_movimentacoes === 0` e `erros.length > 0` | Idem (defesa se API não enviar 422) |
| `200` e `total_movimentacoes > 0` e `erros.length > 0` | Redirect + `warningMessage` listando falhas |
| `200` e sem erros | Redirect normal |

`errorMessage`: primeira mensagem amigável ou resumo (“Nenhum arquivo processado: …”).

### `SubmissionProgressPanel`

Nova prop opcional `erros?: Array<{ nome; mensagem }>` — lista abaixo das etapas com estilo de alerta.

### `wizard.tsx`

- Erro: `role="alert"`, texto vermelho  
- Botão **Tentar novamente** chama `reset()` do hook (habilitado em `phase === error`)  

---

## 8. Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| `packages/core/src/ingest/errors.ts` | **Novo** — `classifyIngestError`, códigos, mensagens |
| `packages/core/src/ingest/log.ts` | **Novo** — logger JSON |
| `packages/core/src/ai/openrouter.ts` | Corrigir `resolveExtratoModel`; enriquecer erros para classificação |
| `packages/core/src/ingest/pdf-text.ts` | Classificar erros de parse |
| `packages/core/src/ingest/pdf.ts` | Logs por fase; rethrow com código |
| `packages/core/src/ingest/pipeline.ts` | Logs; `erroMensagem` amigável |
| `packages/core/src/index.ts` | Exportar tipos/helpers se necessário |
| `apps/web/.../upload/route.ts` | 422, `erros` tipados, logs |
| `apps/web/hooks/use-prestacao-submit.ts` | Regra B, parse 422 |
| `apps/web/components/prestacao/submission-progress-panel.tsx` | Lista de erros |
| `apps/web/components/prestacao/wizard.tsx` | Retry, exibir erros |
| `apps/web/.env.example` | Comentário: `OPENROUTER_MODEL` não é usado para PDF |

---

## 9. Testes

| Caso | Onde |
|------|------|
| `resolveExtratoModel` ignora `OPENROUTER_MODEL` | `openrouter-extrato.test.ts` |
| `classifyIngestError` mapeia mensagens conhecidas | `errors.test.ts` |
| `ingestFileBuffer` grava mensagem amigável em ERRO | `pipeline` ou integração mock |
| Hook: 422 → não redirect | teste unitário do hook ou componente |

---

## 10. Fora de escopo

- Painel admin para ver logs de ingestão  
- SSE / job assíncrono  
- Alterar limite de 3 páginas  
- Commit automático da spec (feito pelo desenvolvedor quando desejar)  

---

## 11. Critérios de aceite

1. PDF de extrato com `OPENROUTER_API_KEY` configurada usa modelo de visão/texto adequado (não Kimi por fallback).
2. Falha total no upload retorna 422 e o wizard **não** redireciona; mensagem amigável visível.
3. Upload parcial (OFX ok + PDF falhou) redireciona com aviso citando o PDF.
4. Logs em Vercel mostram JSON com `fase`, `filename`, `codigoErro` em falhas.
5. Testes unitários cobrem modelo PDF e classificação de erros.
