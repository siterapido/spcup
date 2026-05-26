# Feedback de processamento no wizard — Design

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:** `2026-05-26-fluxo-prestacao-contas-design.md`

---

## 1. Resumo

No passo 5 do wizard (“Nova prestação”), ao clicar **Iniciar prestação**, substituir o único feedback (“Processando…” no botão) por painel com **barra de progresso**, **etapas nomeadas** e manutenção da **pré-visualização** dos anexos. Progresso combina **fases fixas** (criar sessão, ingestão, redirect) com **percentual real de upload** via `XMLHttpRequest`.

---

## 2. Decisão de produto

| Tema | Decisão |
|------|---------|
| Modelo de progresso | **D** — etapas fixas + % real na fase de upload |
| API backend | Sem alteração; `POST sessoes` + `POST upload` monolítico |
| Pré-visualização | Manter `AttachmentDropzone` visível; desabilitar add/remove durante submit |
| Excel no browser | Fora de escopo (mensagem existente pós-seleção) |
| Ingestão no core | Indeterminada até resposta JSON; UI em “Processando movimentações…” |

---

## 3. Fases e pesos da barra

| Fase | % acumulado | Texto (exemplo) |
|------|-------------|-----------------|
| Criar sessão | 0 → 15 | Criando sessão… |
| Upload (bytes) | 15 → 85 | Enviando `arquivo.pdf`… |
| Aguardar ingestão | 85 → 92 | Processando movimentações… |
| Redirect | 92 → 100 | Abrindo kanban… |

Fórmula durante upload: `15 + 70 * (loaded / total)`.

---

## 4. Componentes

| Arquivo | Responsabilidade |
|---------|------------------|
| `use-prestacao-submit.ts` | Hook: fases, %, `submit()`, XHR upload, erros |
| `submission-progress-panel.tsx` | Barra, checklist de etapas, chips de arquivos |
| `wizard.tsx` | Integração; estado de processamento |
| `attachment-dropzone.tsx` | Prop `disabled` |

### Checklist de etapas (UI)

1. Criar sessão  
2. Enviar arquivos  
3. Processar movimentações  
4. Abrir kanban  

Estados por etapa: `pending` | `active` | `done` | `error`.

---

## 5. Comportamento de erro

- Falha ao criar sessão: etapa 1 em erro, barra ~15%, mensagem da API, botão retry habilitado após `reset`.
- Falha no upload/ingestão: etapa 2 ou 3 em erro, mensagem API; não redireciona.
- Upload parcial (`erros[]` na resposta): manter redirect ao kanban com aviso (comportamento atual do wizard).

---

## 6. Acessibilidade

- `role="progressbar"` na barra com `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
- Região de status com `aria-live="polite"`.

---

## 7. Fora de escopo

- SSE / job assíncrono no servidor  
- Upload arquivo a arquivo (opção C)  
- Pré-visualização de planilha Excel no cliente  
- Percentual real da ingestão dentro de `@spc-up/core`
