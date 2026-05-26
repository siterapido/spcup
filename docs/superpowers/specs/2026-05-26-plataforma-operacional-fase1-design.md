# Plataforma operacional — Fase 1 (Design)

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Entrega:** Fase 1 — cadastros prestador, revisão kanban completa, navegação integrada  
**Relacionado:**

- `2026-05-25-spc-up-prestacao-contas-design.md`
- `2026-05-26-fluxo-prestacao-contas-design.md`
- `2026-05-26-cadastro-pf-pj-design.md`

**Fase 2 (fora deste spec):** dashboard com estatísticas do sistema; polish cadastro PF/PJ (máscaras, validação, UX import/conflitos); refinamento visual global (impeccable).

---

## 1. Resumo

Consolidar a operação nacional em torno do **fluxo por sessão de prestação**, com cadastro confiável de **prestadores estaduais e municipais** (CNPJ obrigatório e validado), **revisão de transações** no kanban com painel de detalhe e vínculo PF/PJ, e **navegação** que liga dashboard, prestação, pessoas e administração sem duplicar caminhos contraditórios.

Decisão de produto herdada: entrega em **duas fases**; este documento cobre apenas a Fase 1.

---

## 2. Decisões de produto (registro)

| Tema | Decisão |
|------|---------|
| Faseamento | **B** — Fase 1 operacional (cadastros + kanban + nav); Fase 2 stats + PF/PJ polish |
| Diretório estadual | **Híbrido** — manutenção das 27 UFs (não criar UF nova); edição web + import planilha |
| Diretório municipal | Evoluir CRUD atual: validação CNPJ, IBGE opcional, import UI, editar/desativar |
| CNPJ | Obrigatório; validação de dígitos verificadores em formulário e import |
| Kanban revisão | Drawer de detalhe, coluna Rejeitado, vínculo PF/PJ, reprocessar IA; **sem** drag-and-drop na Fase 1 |
| Upload legado (`/` por UF) | Mantido, seção recolhida “Operações por UF (legado)”; fluxo principal = wizard + sessão |
| Lista `/movimentacoes` | Mantida como visão legado por UF; não é o fluxo principal |
| Auth admin | Apenas perfil **nacional** (mesma regra do piloto) |
| UI shell | **Abordagem B** — layout com subnav contextual em `/prestacao/*` e `/admin/*` |

---

## 3. Contexto — estado atual

| Área | Existe | Gap |
|------|--------|-----|
| `diretorio_estadual` | Schema + seed 27 UFs (CNPJs placeholder) | Sem UI/API de manutenção |
| `diretorio_municipal` | Schema + CRUD web mínimo | Sem import UI; sem validação CNPJ; sem editar/desativar |
| Kanban sessão | Colunas, mover status, confirmar lote, export | Sem drawer; sem PATCH pessoa; coluna Rejeitado fraca; agrupamento por arquivo duplicado |
| Dashboard `/` | CTA prestação, sessões, upload/export legado | Sem estatísticas (Fase 2) |
| Cadastro PF/PJ | API + páginas básicas | Polish adiado Fase 2 |

---

## 4. Arquitetura Fase 1

### 4.1 Visão

```
[App shell: nav + subnav contextual]
    │
    ├── / ........................ hub (CTA sessão, sessões recentes, legado recolhido)
    ├── /prestacao/nova .......... wizard (inalterado em papel)
    ├── /prestacao/[id]/kanban ... revisão (drawer + colunas + vínculo pessoa)
    ├── /admin/diretorios-estaduais ... manutenção 27 UFs
    ├── /admin/diretorios-municipais . CRUD + import
    └── /pessoas/* ............... mantido (sem mudança de escopo Fase 1)
```

Lógica de negócio nova ou estendida em `@spc-up/core`; APIs em `apps/web/app/api/**`; componentes em `apps/web/components/**`.

### 4.2 Componentes novos ou estendidos

| Componente | Responsabilidade |
|------------|------------------|
| `packages/core/src/prestacao/estadual.ts` | Listar 27 UFs, `upsertDiretorioEstadual`, `importDiretoriosEstaduais` |
| `packages/core/src/prestacao/municipal.ts` | Estender: update por id, desativar, validação CNPJ explícita |
| `packages/core/src/prestacao/movimentacao-review.ts` | `getMovimentacaoDetalhe`, `assignPessoa`, `reprocessarIa` (orquestra match IA existente) |
| `apps/web/components/layout/operacao-shell.tsx` | Subnav Prestação / Admin |
| `apps/web/components/prestacao/review-drawer.tsx` | Painel lateral kanban |
| `apps/web/app/admin/diretorios-estaduais/**` | UI estadual |
| APIs admin estadual + import municipal | REST |

---

## 5. Cadastro de prestadores

### 5.1 Diretório estadual

**Modelo:** tabela `diretorio_estadual` existente (`uf` unique, `cnpj_prestador`, `nome`, `ativo`).

**Regras:**

- Não permitir `INSERT` com UF fora das 27 siglas válidas.
- `upsert` por `uf`: atualiza `cnpj_prestador`, `nome`, `ativo`.
- CNPJ normalizado 14 dígitos; rejeitar inválido (dígitos verificadores).
- Seed (`scripts/seed-diretorios.ts`) permanece para bootstrap; produção usa import ou edição web.
- UI destaca linhas cujo CNPJ ainda é placeholder do seed (prefixo `00000000000` ou flag derivada).

**Import planilha** (colunas case-insensitive):

| Coluna | Obrigatório |
|--------|-------------|
| `uf` | Sim |
| `cnpj_prestador` ou `cnpj` | Sim |
| `nome` | Sim |

Resposta: `{ atualizados, erros: [{ linha, motivo }] }` — linha com erro não aborta o arquivo.

### 5.2 Diretório municipal (evolução)

Manter criação de novos municípios (CNPJ unique global).

**Adições Fase 1:**

- Validação CNPJ em `upsertDiretorioMunicipal` e import.
- `PATCH` por `id`: `nome_municipio`, `codigo_ibge`, `cnpj_prestador`, `ativo`.
- UI: botão importar planilha (usa `importDiretoriosMunicipais` existente).
- Campo `codigo_ibge` opcional no formulário.

**Import** (já suportado no core): `uf`, `nome_municipio`, `cnpj_prestador`, `codigo_ibge?`.

### 5.3 APIs admin

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/admin/diretorios-estaduais` | Lista 27 (filtro `ativo` opcional) |
| PATCH | `/api/admin/diretorios-estaduais/[id]` | Atualiza CNPJ, nome, ativo |
| POST | `/api/admin/diretorios-estaduais/import` | Multipart ou JSON rows |
| GET | `/api/admin/diretorios-municipais` | (existente) |
| POST | `/api/admin/diretorios-municipais` | (existente) |
| PATCH | `/api/admin/diretorios-municipais/[id]` | **novo** |
| POST | `/api/admin/diretorios-municipais/import` | **novo** |

Todas exigem sessão nacional (`requireSession` + role).

### 5.4 Impacto no wizard

- Passo municipal: se lista vazia para UF, mensagem + link `/admin/diretorios-municipais`.
- Passo estadual: exibir CNPJ/nome do `diretorio_estadual` da UF; se placeholder, aviso “configure CNPJ real em Diretórios estaduais”.

---

## 6. Revisão de transação (kanban)

### 6.1 Colunas

| Coluna UI | Status DB |
|-----------|-----------|
| Rascunho | `RASCUNHO` |
| Revisão | `PENDENTE_REVISAO` |
| Confirmado | `CONFIRMADO` |
| Exportado | `EXPORTADO` |
| Rejeitado | `REJEITADO` |

Transições: manter matriz em `packages/core/src/prestacao/status.ts` (`ALLOWED`).

### 6.2 Agrupamento por arquivo

- Cards agrupados sob cabeçalho recolhível por `arquivo_ingestao` **dentro de cada coluna**.
- Remover seção duplicada “Agrupamento por arquivo” no rodapé da página.

### 6.3 Drawer de revisão

Abrir ao clicar no card (não só botões → status).

**Conteúdo:**

- Identificação: valor, data, direção, `descricao_raw`, nome arquivo origem.
- IA: `confianca_global`, `justificativa` (texto completo), badge “IA indisponível”.
- Lacunas: chips a partir de `campos_faltantes` / validação XSD.
- Pessoa: resumo atual; busca PF/PJ (autocomplete por documento ou nome); ações “Vincular”, “Cadastrar nova pessoa” (query `?retorno=/prestacao/[sessaoId]/kanban`).
- Bloqueio: exibir `bloqueio_export` e motivo.
- Ações: mover status (mesmas transições permitidas), Confirmar (se elegível), Rejeitar, Reprocessar IA.

### 6.4 APIs de revisão

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/movimentacoes/[id]` | Detalhe para drawer |
| PATCH | `/api/movimentacoes/[id]` | `{ pessoaFisicaId?, pessoaJuridicaId?, limparPessoa? }` — mutuamente exclusivo PF/PJ |
| PATCH | `/api/movimentacoes/[id]/status` | (existente) |
| POST | `/api/movimentacoes/[id]/reprocessar-ia` | Reexecuta `evaluateMovimentacaoWithAi` + `applyAiResult` |
| POST | `/api/movimentacoes/confirm` | (existente) lote |

**`assignPessoa`:**

- Limpa FK oposta ao vincular PF ou PJ.
- Dispara `applyDeterministicMatch` ou recalcula confiança mínima (evidência `CPF_CADASTRO` / `CNPJ_CADASTRO` quando nome não stub).
- Não altera status para `CONFIRMADO` automaticamente.

**Confirmar (single ou lote):**

- Rejeitar se `bloqueio_export === true`.
- Rejeitar se lacunas XSD críticas listadas em `REQUIRED_SPCA_FIELDS` (reutilizar helper de export).

### 6.5 Reprocessar IA

- Disponível quando `iaIndisponivel` ou operador solicita manualmente.
- Idempotente: sobrescreve evidências IA anteriores do mesmo tipo; não altera `CONFIRMADO`/`EXPORTADO` sem ação humana explícita de status.

### 6.6 Fora de escopo kanban Fase 1

- Drag-and-drop entre colunas.
- Edição inline de todos os campos SPCA (`movimentacao_spca`) — Fase 2 ou spec dedicada.
- Colunas operacionais extras (Match / IA / Lacunas) além do status DB.

---

## 7. Navegação e hub

### 7.1 Nav principal (`app-nav.tsx`)

| Item | Destino |
|------|---------|
| Dashboard | `/` |
| Prestação | dropdown: Nova (`/prestacao/nova`), link última sessão se houver |
| Pessoas | `/pessoas` |
| Admin | dropdown: Estaduais, Municipais |

### 7.2 Subnav contextual

Renderizar abaixo do header quando path ∈ `/prestacao/*` ou `/admin/*`:

- Prestação: `Nova prestação` | (breadcrumb dinâmico na kanban)
- Admin: `Estaduais` | `Municipais`

### 7.3 Dashboard `/`

**Primário:** card “Nova prestação” + lista sessões recentes (existente).

**Secundário (recolhido `<details>`):** “Operações por UF (legado)” — filtro UF/exercício, upload, export ZIP por UF (comportamento atual). Texto explicativo: preferir fluxo por sessão para prestador municipal ou múltiplos arquivos.

---

## 8. Interface (impeccable / PRODUCT.md)

- Register: **product** — operação primeiro, tema claro, Notion-like.
- Sem hero metrics, sem grids decorativos de cards idênticos.
- Tabelas administrativas densas mas legíveis; badges de status com texto (não só cor).
- CNPJ mascarado em listagens (`**.***.***/****-**`); completo só em edição.
- Amarelo UP apenas em acentos e nav ativa.

---

## 9. Erros e validação

| Situação | Comportamento |
|----------|----------------|
| CNPJ inválido no admin | 400 com mensagem clara |
| Confirmar com bloqueio | 400 “Não é possível confirmar…” |
| Transição status ilegal | 400 com transição indicada |
| Import linha inválida | Acumula em `erros[]`; demais linhas processam |
| UF desconhecida no import estadual | Erro na linha |
| Reprocessar IA sem API key | Badge + 503 com retry |

---

## 10. Segurança

- Rotas `/admin/*` e APIs admin: apenas usuário nacional autenticado.
- Logs: mascarar CPF/CNPJ em INFO.
- Audit log (mínimo Fase 1): registrar PATCH diretório estadual/municipal e assign pessoa em movimentação (tabela `audit_log` se existir; senão log estruturado).

---

## 11. Testes

| Tipo | Cobertura |
|------|-----------|
| Unit | `estadual.ts` upsert/import; validação CNPJ; `assignPessoa`; confirmar com bloqueio |
| Unit | Transições `updateMovimentacaoStatus` inalteradas |
| Integration | Import estadual atualiza CNPJ; wizard aviso placeholder |
| Integration | PATCH movimentação vincula PF e bloqueia confirm se lacuna |
| Manual | Fluxo: configurar UF SP → nova sessão estadual → upload → revisar drawer → confirmar → export |

---

## 12. Migração

- Sem migration de schema obrigatória Fase 1 (tabelas já existem).
- Opcional: script one-off ou banner se `cnpj_prestador` like `00000000000%` para UFs em produção.

---

## 13. Fase 2 (referência, não implementar agora)

1. **Dashboard técnico:** agregados por status, UF, sessão, ingest ERRO, conflitos cadastro, taxa confiança, exportáveis vs bloqueados.
2. **Cadastro PF/PJ:** máscaras, validação dígito, `titulo_eleitor`, melhorias import/conflitos/perfil.
3. **Polish UI** transversal (layout, tipografia, empty states).

Spec Fase 2: documento separado após conclusão Fase 1.

---

## 14. Próximo passo

Plano de implementação em `docs/superpowers/plans/2026-05-26-plataforma-operacional-fase1.md` (skill writing-plans), após revisão deste spec pelo usuário.
