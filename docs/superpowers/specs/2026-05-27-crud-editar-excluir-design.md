# Editar e excluir dados operacionais (Design)

**Data:** 2026-05-27  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado para implementação (blocos 1–3 validados em brainstorming)  
**Relacionado:**
- [2026-05-25-spc-up-prestacao-contas-design.md](./2026-05-25-spc-up-prestacao-contas-design.md)
- [2026-05-26-cadastro-pf-pj-design.md](./2026-05-26-cadastro-pf-pj-design.md)
- [2026-05-26-fluxo-prestacao-contas-design.md](./2026-05-26-fluxo-prestacao-contas-design.md)
- [2026-05-26-consolidacao-extratos-design.md](./2026-05-26-consolidacao-extratos-design.md)

---

## 1. Resumo executivo

Expor **editar** e **excluir** (lógico) nas entidades que a equipe nacional opera no dia a dia, com regras que protegem dados já consolidados para export SPCA.

**Escopo da entrega (fase única):**

| Entidade | Editar | Excluir |
|----------|--------|---------|
| Pessoa PF/PJ | Sim | Soft (`deleted_at`) |
| Movimentação | Sim (por status) | Soft; bloqueio em estados finais |
| Sessão de prestação | Sim (metadados) | Soft; só sessão elegível |
| Evento consolidação | Não (workflow) | Soft; só `PENDENTE` |
| Diretório municipal | Sim (já existe) | Desativar (`ativo=false`) |
| Diretório estadual | Sim (já existe) | Desativar (`ativo=false`) — paridade |

**Princípio global (decisão D):** soft delete em cadastro e registros operacionais; **nunca** exclusão física em cascata; movimentação **exportada** não pode ser excluída nem editada de forma destrutiva.

---

## 2. Decisões de produto (registro)

| Tema | Decisão |
|------|---------|
| Exclusão com vínculos | Soft delete; FKs preservadas; listagens ocultam deletados |
| Movimentação exportada | Bloquear soft delete; edição mínima (desvincular pessoa / `REJEITADO`) |
| Movimentação confirmada | Bloquear soft delete (default até revisão contrária) |
| Consolidação pendente | Soft delete (`deleted_at`), distinto de Aprovar/Rejeitar |
| Soft delete — colunas | `deleted_at` em pessoa, movimentação, sessão, evento consolidação; `ativo` em diretórios |
| UI | Modal para entidades simples; página dedicada para pessoa e movimentação |
| Implementação | Fatias verticais + componente compartilhado de confirmação após 1ª entidade |
| Auditoria | v1: timestamps `deleted_at` + `updated_at`; tabela `audit_log` fora do escopo |
| Auth | Mesmo gate atual (`requireSession`); equipe nacional |

---

## 3. Modelo de dados (migration)

### 3.1 Novas colunas

```sql
-- pessoa_fisica, pessoa_juridica
deleted_at TIMESTAMPTZ NULL

-- movimentacao
deleted_at TIMESTAMPTZ NULL

-- sessao_prestacao
deleted_at TIMESTAMPTZ NULL

-- consolidacao_evento
deleted_at TIMESTAMPTZ NULL
```

Índices recomendados (parciais ou compostos) nas listagens quentes, por exemplo `(uf, exercicio) WHERE deleted_at IS NULL` em `movimentacao` se o planner não filtrar bem.

### 3.2 Sem alteração

- `diretorio_estadual.ativo`, `diretorio_municipal.ativo` — exclusão lógica existente.
- CPF/CNPJ permanecem imutáveis após criação.

### 3.3 Queries

Toda listagem e busca operacional deve incluir `deleted_at IS NULL`. `GET` por id de entidade soft-deleted retorna **404**.

---

## 4. Regras de negócio (`packages/core`)

### 4.1 Pessoa (`updatePessoa`, `softDeletePessoa`)

**Editar (`PATCH`):** `nome`, `titulo_eleitor` (PF), `aliases` (array). Documento não alterável.

**Excluir:** define `deleted_at = now()`. Permitido mesmo com movimentações vinculadas (histórico preservado; pessoa some das listas e buscas de cadastro).

**Restaurar:** fora do escopo v1.

### 4.2 Movimentação (`updateMovimentacao`, `softDeleteMovimentacao`)

| Status | Campos editáveis | Soft delete |
|--------|------------------|-------------|
| `RASCUNHO`, `PENDENTE_REVISAO` | `data_movimento`, `valor`, `descricao_raw`, `direcao`, vínculo pessoa, campos `movimentacao_spca` quando existir | Permitido |
| `CONFIRMADO` | Campos SPCA + vínculo pessoa; não alterar valor/data/direção sem voltar status (fora do escopo — bloquear alteração destrutiva) | **Bloqueado** (409) |
| `EXPORTADO` | Apenas `limparPessoa` / fluxo existente; status → `REJEITADO` via rota de status | **Bloqueado** (409) |
| `REJEITADO` | Vínculo pessoa; campos SPCA limitados | Permitido soft delete |

Códigos de erro estáveis: `MOVIMENTACAO_EXPORTADA`, `MOVIMENTACAO_CONFIRMADA`, `MOVIMENTACAO_NOT_FOUND`, `MOVIMENTACAO_DELETED`.

### 4.3 Sessão (`updateSessao`, `softDeleteSessao`)

**Editar:** `consolidarExtratos`, e somente se `status = ABERTA`: ajuste de metadados que não invalidem ingestão já feita (UF/exercício/tipo prestador — permitir apenas se **nenhum** `arquivo_ingestao` e **nenhuma** `movimentacao` vinculada à sessão; caso contrário 409 `SESSAO_COM_DADOS`).

**Excluir:** soft delete somente se:

- `status = ABERTA`
- zero registros em `arquivo_ingestao` para a sessão
- zero `movimentacao` com `sessao_prestacao_id` da sessão
- zero `consolidacao_evento` não deletados para a sessão

### 4.4 Evento consolidação (`softDeleteConsolidacaoEvento`)

- Somente `status = PENDENTE` e `deleted_at IS NULL`.
- Define `deleted_at`; não altera `status` para `REJEITADO` (semânticas diferentes: rejeição é decisão de qualidade; exclusão é retirada da fila).
- Eventos `APROVADO` / `REJEITADO`: sem exclusão na v1.

### 4.5 Diretórios

- **Municipal / estadual:** `PATCH` existente; adicionar ação **Desativar** (`ativo = false`). Listagens admin com filtro `ativoOnly` já suportado.
- Não remover linha do banco; não usar `deleted_at` em diretórios.

---

## 5. API REST (`apps/web/app/api`)

| Rota | Métodos novos/alterados | Notas |
|------|-------------------------|-------|
| `/api/pessoas/[id]` | `PATCH`, `DELETE` | Query `tipo=pf\|pj` obrigatório |
| `/api/movimentacoes/[id]` | `PATCH` (expandir), `DELETE` | Unificar schema Zod por status |
| `/api/prestacao/sessoes/[id]` | **Novo arquivo** `PATCH`, `DELETE` | |
| `/api/prestacao/sessoes/[id]/consolidacao/eventos/[eid]` | `DELETE` | Soft delete pendente |
| `/api/admin/diretorios-municipais/[id]` | `PATCH` incluir `ativo: false` ou `DELETE` alias | Paridade UX “Excluir” |
| `/api/admin/diretorios-estaduais/[id]` | Idem | Paridade |

Respostas de bloqueio: HTTP **409** com `{ error: string, code: string }`. Sucesso delete: **200** `{ ok: true }` ou **204**.

---

## 6. UI (`apps/web`)

### 6.1 Componentes compartilhados

- `ConfirmDeleteDialog`: título, descrição, botão destrutivo, `onConfirm` async.
- Opcional após pessoa: `EntityRowActions` (Editar | Excluir).

### 6.2 Superfícies

| Superfície | Editar | Excluir |
|------------|--------|---------|
| `pessoas-table.tsx` | Link → `/pessoas/[id]/editar` | Dialog → `DELETE` |
| `pessoa-perfil.tsx` | Botão Editar | Botão Excluir |
| `movimentacoes-table.tsx` | Link → `/movimentacoes/[id]/editar` | Dialog; tooltip se bloqueado |
| Kanban / `review-drawer.tsx` | Link Editar | Excluir se elegível |
| Lista sessões (wizard / dashboard prestação) | Modal PATCH | Dialog DELETE |
| `consolidacao-table.tsx` | — | “Excluir” em pendente → `DELETE` evento |
| `admin/diretorios-municipais` | Modal (existente) | “Desativar” |
| `admin/diretorios-estaduais` | Modal (existente) | “Desativar” |

Formulário de edição de movimentação: reutilizar campos do review drawer onde possível; seção SPCA colapsável quando `movimentacao_spca` existir.

### 6.3 Mensagens UX

- Bloqueio exportado: “Movimentação já exportada; não pode ser excluída.”
- Bloqueio confirmado: “Confirme como rejeitada ou desvincule antes de excluir.” (ajustar copy após implementação)
- Sessão com dados: “Sessão já possui arquivos ou movimentações; não pode ser excluída.”

---

## 7. Ordem de implementação (fatias verticais)

1. Migration + helpers `notDeleted` no Drizzle/schema.
2. **Pessoas:** core → API → `/pessoas/[id]/editar` + tabela/perfil.
3. **Movimentações:** core → API → página editar + tabela/kanban.
4. **Sessões:** core → API → UI lista sessão.
5. **Consolidação:** core → API → botão na tabela.
6. **Diretórios:** desativar municipal + paridade estadual.
7. Testes unitários core + testes de rota críticos.

---

## 8. Testes

| Área | Casos mínimos |
|------|----------------|
| `softDeletePessoa` | set `deleted_at`; lista não retorna |
| `softDeleteMovimentacao` | ok em `RASCUNHO`; 409 em `EXPORTADO` e `CONFIRMADO` |
| `softDeleteSessao` | ok vazia; 409 com ingestão |
| `softDeleteConsolidacaoEvento` | ok `PENDENTE`; 409 se aprovado |
| API | auth 401; 404 deletado; 409 códigos |

---

## 9. Fora de escopo v1

- Restaurar registro soft-deleted.
- `audit_log` dedicado.
- Exclusão física (`DELETE` SQL cascade).
- RBAC por UF.
- Editar CPF/CNPJ (merge de duplicatas).

---

## 10. Critérios de aceite

1. Usuário autenticado edita nome de PF na web e vê alteração no perfil e na lista.
2. Usuário exclui (soft) pessoa e ela desaparece da busca; movimentações antigas mantêm FK.
3. Usuário não consegue excluir movimentação `EXPORTADO` (mensagem clara).
4. Usuário exclui evento consolidação pendente; some da fila; registro permanece no banco com `deleted_at`.
5. Usuário desativa diretório municipal; some de listagem `ativoOnly=true`.
6. Testes automatizados dos bloqueios 409 passam no CI.
