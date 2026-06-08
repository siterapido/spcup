# Mapeamento de colunas + NotebookLM — Design

**Data:** 2026-06-08  
**Status:** Aprovado (grill-me)  
**Relacionado:** `2026-06-02-pdf-extrato-mapeamento-colunas-design.md`, `2026-06-06-notebooklm-default-design.md`, `2026-06-08-notebooklm-multi-pdf-design.md`

---

## 1. Problema

O wizard coleta `ExtratoColumnMap` por PDF, mas o pipeline padrão (NotebookLM) ignora o mapa: `POST /processar` sem body e `buildNotebookLmExtratoPrompt` sem hint de colunas.

## 2. Objetivo

Integrar o mapa de colunas ao NotebookLM com **alta precisão**, mantendo auto-discover + revisão no cliente.

## 3. Decisões (grill-me)

| Tema | Decisão |
|------|---------|
| NotebookLM | Hint obrigatório via `buildExtratoColumnPromptHint` em cada query por PDF |
| UX | Auto-discover + revisão; painel abre ao anexar 1º PDF |
| Campos obrigatórios | `data`, `valor`, `nome`, `historico`, `documento` |
| Campos opcionais | `saldo`, `tipo_pix`, `situacao`, `hora`, `direcao` (quando não detectada) |
| Custom fields | Mantidos visíveis (input livre) |
| Direção | Se auto detectar coluna D/C no cabeçalho → obrigar mapear `direcao`; senão `inferirDirecaoDoValor=true` |
| Multi-PDF | Botão "Usar mesmo layout nos outros" — cópia integral do mapa ativo |
| Precisão | Faixas coloridas + arraste de bordas + `%` no hint |
| Persistência | `arquivo_ingestao.metadados.extratoColumnMap` ao processar |
| Transporte | `extratoColumnMaps: Record<arquivoId, ExtratoColumnMap>` no body de `POST .../processar` |

## 4. Arquitetura

```
Wizard (clientFileKey → ExtratoColumnMap)
  → upload PDFs → arquivoId por job
  → POST /processar { extratoColumnMaps: { [arquivoId]: map } }
       → processSessaoWithNotebookLM(db, sessaoId, { extratoColumnMaps })
            → persist metadados.extratoColumnMap
            → queryNotebook(prompt = buildNotebookLmExtratoPrompt(nome, map))
            → movimentações
```

Fallback OpenRouter (por página) continua recebendo mapa via `processarPaginaExtrato` (já implementado).

## 5. Contrato

### 5.1 Body `POST /api/prestacao/sessoes/[id]/processar`

```json
{
  "extratoColumnMaps": {
    "uuid-arquivo-1": {
      "paginaReferencia": 1,
      "inferirDirecaoDoValor": true,
      "colunaDirecaoDetectada": false,
      "colunas": [ ... ]
    }
  }
}
```

### 5.2 Validação (`validateExtratoColumnMap`)

- Sempre: `data`, `valor`, `nome`, `historico`, `documento`
- Direção: `direcao` mapeada **ou** `inferirDirecaoDoValor === true`, exceto quando `colunaDirecaoDetectada === true` → exige `direcao`

### 5.3 Prompt NotebookLM

`buildNotebookLmExtratoPrompt(nomeArquivo, map?)` — se `map` presente, append `\n\n---\n` + `buildExtratoColumnPromptHint(map)` + `\n---`

## 6. UI

- Remover dependência de toggle para ver mapa: `showColumnMap=true` quando `hasPdf`
- `canSubmit` bloqueado até todos PDFs com mapa válido
- Botão "Usar mesmo layout nos outros" no hook `useExtratoColumnMap`
- Campos obrigatórios com indicador visual; opcionais com badge "opcional"

## 7. Schema DB

Adicionar coluna `metadados jsonb` em `arquivo_ingestao` (migration Drizzle).

## 8. Testes

- `validateExtratoColumnMap` — 5 campos + direção condicional
- `buildNotebookLmExtratoPrompt` — contém hint quando map presente
- `process-sessao-notebooklm.test.ts` — map passado ao query, metadados persistido
- `extrato-column-map-client` — auto detecta keywords direção

## 9. Fora de escopo

- Templates de mapa entre sessões
- Mapeamento por página diferente
