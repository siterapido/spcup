# Movimentações aprovadas — registro consultivo (Design)

**Data:** 2026-06-08  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado (grill-me 2026-06-08)  
**Relacionado:**
- [2026-06-07-planilha-unificada-design.md](./2026-06-07-planilha-unificada-design.md)
- [2026-05-25-spc-up-prestacao-contas-design.md](./2026-05-25-spc-up-prestacao-contas-design.md)
- [2026-05-26-plataforma-operacional-fase1-design.md](./2026-05-26-plataforma-operacional-fase1-design.md)

---

## 1. Resumo

Reformular a aba global **`/movimentacoes`** (nav principal) como **registro consultivo** de movimentações já aprovadas, com filtros por **UF** e **mês/ano**, paginação server-side, drill-down read-only e exports (CSV, XLSX lista, submenu SPCA).

**Objetivo:** auditoria e visão agregada mensal por estado — sem competir com a planilha unificada (`/prestacao/[id]/planilha`), onde ocorre revisão e edição.

**Escopo:** Fase 1 web + API. Sem migration de schema.

---

## 2. Problema atual

| Sintoma | Causa |
|---------|-------|
| Operador não sabe se revisa em Movimentações ou Planilha | Duas telas com papéis sobrepostos |
| Lista mistura pendentes e confirmadas | API retorna todos os `status` |
| Filtro por exercício, não por mês | UX não bate com “movimentações de janeiro” |
| Client carrega recorte inteiro | Sem paginação |
| Botão Confirmar na lista global | Fluxo legado pré-planilha |
| Sem export estruturado do recorte | Só badge “exportável” por UF+exercício |

A rota de sessão `/prestacao/[id]/movimentacoes` **já redireciona** para `/planilha` — permanece assim.

---

## 3. Decisões de produto (grill-me)

| # | Tema | Decisão |
|---|------|---------|
| 1 | Papel da aba | Registro de **aprovadas** com filtros UF + mês; revisão na planilha |
| 2 | O que é “aprovada” | `status ∈ { CONFIRMADO, EXPORTADO }` |
| 3 | Filtros | **UF + mês/ano**; `exercicio` implícito = ano do mês |
| 4 | Campo do mês | `data_movimento` (data da transação no extrato) |
| 5 | Modo | **Somente leitura** na tabela + exports do recorte |
| 6 | Drill-down | **Drawer read-only** + botão “Abrir na planilha” |
| 7 | Colunas | **Operacionais fixas** (sem toggle de extras) |
| 8 | Paginação | Server-side, **50/página**; export = recorte **inteiro** do filtro |
| 9 | Exports | **CSV + XLSX lista**; submenu **SPCA** → espelho (mês) ou ZIP (exercício/prestador) |
| 10 | Ordenação default | `data_movimento DESC`, `cnpj_prestador`, `id` |

---

## 4. Escopo de dados

### 4.1 Inclusão

```sql
WHERE deleted_at IS NULL
  AND movimentacao_canonica_id IS NULL   -- só canônicas pós-merge
  AND status IN ('CONFIRMADO', 'EXPORTADO')
  AND uf = :uf
  AND exercicio = :ano_do_mes
  AND data_movimento BETWEEN :primeiro_dia AND :ultimo_dia
```

### 4.2 Exclusão

- `RASCUNHO`, `PENDENTE_REVISAO`, `REJEITADO`
- Linhas absorvidas em merge (`movimentacao_canonica_id IS NOT NULL`)
- Linhas soft-deleted

### 4.3 Prestadores

O recorte UF+mês pode incluir **vários prestadores** (estadual + municipais). A tabela lista todos misturados; coluna **Prestador** identifica cada linha.

---

## 5. UX — `/movimentacoes`

### 5.1 Barra de filtros

| Controle | Comportamento |
|----------|---------------|
| UF | Input 2 letras; obrigatório; default última UF usada (localStorage) ou `SP` |
| Mês/ano | `<input type="month">` ou seletor equivalente; default mês corrente |
| Atualizar | Re-fetch página 1 |

Copy da página:

> Movimentações confirmadas e exportadas. Para revisar pendências, use a planilha da prestação.

### 5.2 Tabela

| Coluna | Fonte |
|--------|-------|
| Data | `data_movimento` |
| Valor | `valor` formatado |
| Direção | `ENTRADA` / `SAIDA` |
| PF/PJ | nome + documento mascarado |
| Prestador | nome do diretório ou CNPJ formatado |
| Descrição | `descricao_raw` truncada (`line-clamp` / `max-w`) |
| UF | `uf` |
| Status | Badge `CONFIRMADO` ou `EXPORTADO` |

**Removido:** checkbox, botão Confirmar, badge exportável UF legado.

### 5.3 Paginação

- 50 itens por página
- Controles: Anterior / Próxima + “Página X de Y (N total)”
- Ordenação fixa server-side (§3 #10)

### 5.4 Drawer (clique na linha)

Modo **read-only** — reutilizar `review-drawer` com prop `readOnly`:

- Exibir: data, valor, direção, descrição, PF/PJ, confiança, cred/dev, arquivo, origens/PDF (`origens-panel`)
- **Ocultar:** autocomplete PF/PJ, confirmar, reprocessar IA
- Rodapé: botão **Abrir na planilha** → `/prestacao/[sessaoPrestacaoId]/planilha` quando `sessaoPrestacaoId` presente
- Sem sessão: drawer sem link (dados legados)

### 5.5 Toolbar de export

| Botão | Ação |
|-------|------|
| Exportar CSV | Download recorte UF+mês completo |
| Exportar XLSX | Idem, colunas operacionais |
| SPCA ▾ | Submenu |
| → Espelho (mês) | XLSX abas Origem/Aplicação/Doação — só linhas do recorte |
| → Pacote ZIP | XML validados + pendências + espelho — prestador + exercício **inteiro** |

**Pacote ZIP:**

- Se recorte tem 1 prestador → export direto
- Se N prestadores → modal picker (lista distinta de CNPJ/nome no recorte)
- Aviso antes do download: *“Pacote oficial ignora filtro de mês; inclui todas as movimentações confirmadas/exportadas do prestador no exercício.”*
- Gate: `canExportByPrestador` — 403 com mensagem se bloqueado

---

## 6. API

### 6.1 Listagem

`GET /api/movimentacoes`

| Query | Obrigatório | Notas |
|-------|-------------|-------|
| `uf` | sim | 2 letras |
| `mes` | sim | `YYYY-MM` |
| `page` | não | default `1` |
| `limit` | não | default `50`, max `100` |

**Removido como filtro client:** `exercicio` explícito (derivado de `mes`), `status` livre, `min_score`.

**Response:**

```typescript
type MovimentacaoAprovadaItem = {
  id: string;
  uf: string;
  exercicio: number;
  data_movimento: string;
  valor: string;
  direcao: string;
  descricao_raw: string;
  cred_dev: string | null;
  status: "CONFIRMADO" | "EXPORTADO";
  confianca_global: number;
  pessoa_nome: string | null;
  pessoa_documento: string | null;
  cnpj_prestador: string;
  prestador_nome: string | null;
  sessao_prestacao_id: string | null;
  nome_arquivo: string | null;
};

type MovimentacoesListResponse = {
  uf: string;
  mes: string;           // YYYY-MM
  exercicio: number;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  resumo: { confirmadas: number; exportadas: number };
  prestadores: Array<{ cnpj: string; nome: string | null }>;
  items: MovimentacaoAprovadaItem[];
};
```

`prestadores` = distintos no recorte (para modal ZIP).

### 6.2 Exports

| Rota | Formato | Escopo |
|------|---------|--------|
| `GET /api/movimentacoes/export?uf=&mes=&formato=csv` | CSV UTF-8 BOM | Recorte UF+mês |
| `GET /api/movimentacoes/export?uf=&mes=&formato=xlsx` | XLSX | Recorte UF+mês |
| `GET /api/movimentacoes/export/spca-espelho?uf=&mes=` | XLSX espelho | Recorte UF+mês |
| `GET /api/movimentacoes/export/spca-zip?uf=&exercicio=&cnpj_prestador=` | ZIP | Prestador + exercício inteiro |

Colunas CSV/XLSX lista = colunas da tabela + `id`, `sessao_prestacao_id`, `confianca_global`, `nome_arquivo`, `cred_dev`.

### 6.3 Endpoints mantidos (sem mudança de contrato)

- `GET/PATCH/DELETE /api/movimentacoes/[id]` — usados pelo drawer e planilha
- `POST /api/movimentacoes/confirm` — planilha/kanban legado; **não** exposto na nova UI global
- `DELETE /api/movimentacoes` — manter para admin; **não** na UI v1

---

## 7. Core (`@spc-up/core`)

Novo módulo `packages/core/src/movimentacoes-aprovadas/`:

| Função | Responsabilidade |
|--------|------------------|
| `parseMesFilter(mes: string)` | Valida `YYYY-MM`, retorna `{ exercicio, from, to }` |
| `listMovimentacoesAprovadas(db, filters)` | Query paginada + resumo + prestadores distintos |
| `buildMovimentacoesCsvBuffer(rows)` | CSV com BOM |
| `buildMovimentacoesXlsxBuffer(rows)` | XLSX colunas operacionais |
| `buildEspelhoSpcaBufferForIds(db, ids)` | Adaptar `excel-mirror` para subset de IDs |

Reuso: `canExportByPrestador`, `exportPrestacaoZip`, joins `pessoaFisica`/`pessoaJuridica`/`arquivoIngestao`, lookup nome prestador via `diretorioEstadual` / `diretorioMunicipal`.

---

## 8. Navegação

| Item | Mudança |
|------|---------|
| `app-nav.tsx` | Label permanece “Movimentações”; destino `/movimentacoes` |
| `/movimentacoes/page.tsx` | Copy atualizada (§5.1) |
| `/prestacao/[id]/movimentacoes` | Sem mudança (redirect planilha) |

---

## 9. Testes de aceite

| # | Cenário | Resultado |
|---|---------|-----------|
| 1 | UF+jan/2025 com 3 CONFIRMADO + 2 EXPORTADO | Lista 5; pendentes ausentes |
| 2 | Merge cross-PDF aprovado | Só linha canônica aparece |
| 3 | Paginação | 51 linhas → página 2 com 1 item |
| 4 | Ordenação | Data desc; mesmo dia agrupa por prestador |
| 5 | Drawer | Read-only; sem editar PF/PJ |
| 6 | Abrir na planilha | Link correto quando `sessao_prestacao_id` setado |
| 7 | Export CSV | Todas as linhas do mês, não só página 1 |
| 8 | Espelho SPCA | Abas Origem/Aplicação/Doação só com linhas do mês |
| 9 | ZIP multi-prestador | Modal picker; ZIP exercício inteiro |
| 10 | ZIP bloqueado | 403 quando `canExportByPrestador` false |
| 11 | Regressão | `GET /api/movimentacoes/[id]` e planilha inalterados |

---

## 10. Fora de escopo (v1)

- Busca textual (descrição, PF/PJ)
- Filtro “todas UFs” ou por prestador na barra
- Edição / confirmar / excluir na lista global
- Toggle de colunas extras
- Export XML avulso por mês (só ZIP oficial por exercício)
- Mudanças no CLI

---

## 11. Abordagens consideradas

| # | Abordagem | Motivo descarte |
|---|-----------|-----------------|
| 1 | **Registro aprovadas** (escolhida) | — |
| 2 | Inbox só pendências | Usuário pediu todas aprovadas |
| 3 | Evoluir lista legado in-place | Mantém confusão com planilha |
| 4 | Eliminar aba global | Perde visão mensal cross-sessão |
