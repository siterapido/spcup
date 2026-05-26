# Prestação submit progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barra de progresso, etapas nomeadas e prévia mantida durante submit do wizard passo 5.

**Architecture:** Hook `usePrestacaoSubmit` orquestra `fetch` (sessão) + `XHR` (upload com `onprogress`) + redirect; painel presentacional; dropzone com `disabled`.

**Tech Stack:** Next.js App Router, React client components, Tailwind, APIs existentes `/api/prestacao/sessoes`.

---

### Task 1: Hook de submit

**Files:**
- Create: `apps/web/hooks/use-prestacao-submit.ts`

- [ ] Tipos: `SubmitPhase`, `StepId`, `StepState`, `SubmitState`
- [ ] `submit(input)` — POST sessão → XHR upload → parse JSON → callbacks de mensagem parcial
- [ ] `reset()` — volta `idle`
- [ ] Progresso: 15% sessão, 15+70×ratio upload, 85–92 processing, 92–100 redirect

### Task 2: Painel de progresso

**Files:**
- Create: `apps/web/components/prestacao/submission-progress-panel.tsx`

- [ ] Barra Tailwind + `aria-*`
- [ ] Lista 4 etapas com ícone pending/active/done/error
- [ ] Chips dos nomes de arquivo
- [ ] Texto `statusLabel` do hook

### Task 3: Dropzone disabled

**Files:**
- Modify: `apps/web/components/prestacao/attachment-dropzone.tsx`

- [ ] Prop `disabled?: boolean` — sem drag/click/remover; opacidade reduzida

### Task 4: Integrar wizard

**Files:**
- Modify: `apps/web/components/prestacao/wizard.tsx`

- [ ] Usar hook + painel quando `phase !== idle`
- [ ] Manter lógica de `uploadMsg` / erros parciais
- [ ] Botões: desabilitar Voltar/submit durante processamento

### Task 5: Verificação

- [ ] `pnpm exec tsc --noEmit` em `apps/web` (se disponível) ou lint nos arquivos tocados
- [ ] Smoke manual: passo 5 com PDF → barra sobe no upload → redirect kanban
