# Plataforma operacional — Fase 2 (Design)

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:** `2026-05-26-plataforma-operacional-fase1-design.md`, `2026-05-26-cadastro-pf-pj-design.md`

---

## 1. Resumo

Fase 2 completa a **visibilidade operacional** e o **cadastro PF/PJ** para equipe nacional:

1. **Dashboard técnico** em `/` com agregados do sistema (filtro UF + exercício).
2. **Cadastro PF/PJ** com máscaras, validação, `titulo_eleitor`, contexto UF/exercício para re-match, UX de import e conflitos.
3. **Polish UI** leve: empty states, badge conflitos na nav, layout consistente — sem redesign completo.

---

## 2. Decisões de produto

| Tema | Decisão |
|------|---------|
| Dashboard | Substituir bloco “UF/exercício no título” por **painel de métricas**; filtro UF+exercício no topo aplica escopo |
| Escopo métricas | **Nacional** (totais gerais) + bloco **filtrado** (UF + exercício selecionados) |
| Visual métricas | Tabelas/listas densas — **não** hero metrics / cards decorativos (PRODUCT.md) |
| PF/PJ form | Máscara CPF/CNPJ; validação client antes POST; `titulo_eleitor` opcional (PF) |
| Re-match | Form manual e import já disparam no core — form deve enviar `uf` + `exercicio` |
| Retorno kanban | `/pessoas/nova?retorno=...` redireciona após salvar |
| Conflitos | Badge contagem em nav Pessoas; empty state na fila |
| Schema | `titulo_eleitor` já existe em `pessoa_fisica` — só expor na API/UI |
| Fora de escopo | Gráficos/charts; RBAC por UF; merge duplicatas; edição inline movimentacao_spca |

---

## 3. Dashboard técnico

### 3.1 Core — `getSystemStats(db, { uf, exercicio })`

Retorno tipado `SystemStats`:

**Nacional (`global`):**

| Métrica | Fonte |
|---------|--------|
| `movimentacoesPorStatus` | `GROUP BY status` em `movimentacao` |
| `movimentacoesBloqueadas` | `COUNT` onde `bloqueio_export = true` |
| `confiancaFaixas` | buckets: `<0.6`, `0.6–0.85`, `>=0.85` em `confianca_global` |
| `arquivosPorStatus` | `GROUP BY status` em `arquivo_ingestao` |
| `conflitosPendentes` | `cadastro_conflito` status PENDENTE |
| `pessoasPf` / `pessoasPj` | counts |
| `pessoasStub` | PF nome `DESCONHECIDO` + PJ `DESCONHECIDA` |
| `sessoesAbertas` | `sessao_prestacao` ABERTA + EM_PROCESSAMENTO |
| `diretoriosPlaceholder` | estaduais com `isPlaceholderCnpjPrestador` |

**Filtrado (`scoped` — UF + exercício):**

| Métrica | Fonte |
|---------|--------|
| Mesmas dimensões movimentação/arquivo | `WHERE uf AND exercicio` |
| `exportavel` | `canExport(db, uf, exercicio)` |
| `exportavelPrestador` | opcional: count prestadores (estadual+municipal ativos na UF) com `canExportByPrestador` — **simplificado:** só flag `exportavel` UF legado + texto “use sessão para export municipal” |

### 3.2 API

`GET /api/stats?uf=SP&exercicio=2025` → JSON `SystemStats`.

### 3.3 UI `/`

- Layout `max-w-6xl`.
- Filtro UF + exercício (form GET) no topo.
- Seção **Visão nacional** — tabela status movimentações, arquivos, cadastro.
- Seção **UF {uf} · exercício {ano}** — métricas scoped + badge exportável.
- Manter cards CTA (Nova prestação, sessões recentes) e `<details>` legado abaixo.

---

## 4. Cadastro PF/PJ

### 4.1 Formulário (`pessoa-form.tsx`)

- Campos: tipo, documento (máscara), nome, `titulo_eleitor` (se PF), UF contexto, exercício contexto.
- Props: `defaultUf`, `defaultExercicio`, `retornoUrl` (searchParams).
- Validação: chamar helpers client que espelham `normalizeCpf` / `normalizeCnpj` (novo `apps/web/lib/validate-document.ts` com regras exportadas ou duplicadas mínimas).
- POST body inclui `uf`, `exercicio`, `tituloEleitor?`.
- Sucesso: `router.push(retornoUrl ?? '/pessoas')`.

### 4.2 API POST `/api/pessoas`

- Aceitar `tituloEleitor` opcional; persistir em `pessoa_fisica.titulo_eleitor`.
- Exigir `uf` + `exercicio` no body (default SP/2025 se ausente no piloto).

### 4.3 Import (`cadastro-import-form.tsx`)

- Resumo pós-import mais legível (tabela erros por linha).
- Exibir contagem rematch se API retornar.

### 4.4 Conflitos

- `GET /api/pessoas/conflitos/count` ou incluir em stats — badge no `app-nav` link Pessoas.
- Empty state component quando zero pendentes.

### 4.5 Perfil

- Exibir `titulo_eleitor` quando PF.
- Link movimentação → sessão kanban se `sessao_prestacao_id` disponível (senão `/movimentacoes`).

---

## 5. Polish UI

| Item | Ação |
|------|------|
| Empty states | `PessoasTable`, `ConflitosTable`, stats zero rows |
| Nav | Badge numérico conflitos em Pessoas |
| Tipografia | `page.tsx` h1 alinhado a outras rotas (`text-2xl`) |
| Admin link | Dashboard CTA também link estaduais |

---

## 6. Testes

- Unit: `system-stats.test.ts` com DB mock ou queries isoladas.
- Unit: `validate-document.test.ts`.
- Manual: dashboard carrega; form rejeita CPF inválido; retorno kanban funciona.

---

## 7. Próximo passo

Plano: `docs/superpowers/plans/2026-05-26-plataforma-operacional-fase2.md`.
