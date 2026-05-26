# Fluxo de Prestação de Contas — Wizard, Kanban e IA (Design)

**Data:** 2026-05-26  
**Produto:** SPC UP — Unidade Popular  
**Status:** Aprovado (2026-05-26)  
**Relacionado:** `2026-05-25-spc-up-prestacao-contas-design.md`, `2026-05-26-cadastro-pf-pj-design.md`

---

## 1. Resumo

Estender o SPC UP com um fluxo guiado de prestação de contas: o operador nacional escolhe **UF**, **tipo de prestador** (estadual ou municipal com CNPJ distinto), **exercício**, anexa PDFs e planilhas, e acompanha cada **movimentação** em um **kanban** por status. A conciliação com cadastro PF/PJ usa **OpenRouter `moonshotai/kimi-k2.6`** como avaliador principal do “mesmo evento”, com score, justificativa e sinalização de lacunas. A saída inclui **XML SPCA** validados, **templates oficiais** quando versionados no repositório, e **Excel espelho** para auditoria interna.

---

## 2. Decisões de produto (registro)

| Tema | Decisão |
|------|---------|
| Estadual vs municipal | Dois **prestadores** (CNPJ distintos) por prestação |
| Municipal | Seleção em **lista** (`diretorio_municipal`: UF + município + CNPJ) |
| Cadastro municipal | **CRUD** equipe nacional + importação em lote |
| Kanban | **Um card por movimentação**, agrupado por `arquivo_ingestao` |
| Colunas kanban | `RASCUNHO` → `PENDENTE_REVISAO` → `CONFIRMADO` → `EXPORTADO`; `REJEITADO` à parte |
| Match / IA | **IA primeiro**: Kimi avalia mesmo evento; regras duras só CPF/CNPJ inválido e bloqueios XSD |
| Modelo IA | `moonshotai/kimi-k2.6` via OpenRouter (`OPENROUTER_MODEL`) |
| Export | **XML** + **templates TSE** (quando existirem no repo) + **Excel espelho** XSD |
| Agrupamento de uploads | Entidade **`sessao_prestacao`** (abordagem recomendada) |

---

## 3. Arquitetura

### 3.1 Visão

Monorepo existente (`apps/web`, `packages/core`, `packages/db`, `packages/spca`). Novas rotas Next.js para wizard, kanban e admin municipal. Lógica de ingestão, match IA e export permanece em `@spc-up/core`; web orquestra uploads e polling de jobs.

```
Operador → Wizard (sessão) → Upload N arquivos
    → ingest (core) → movimentações RASCUNHO
    → match IA (Kimi) → confianca + match_evidencia + lacunas
    → Kanban (revisão humana) → CONFIRMADO
    → export (XML + Excel + templates) → EXPORTADO
```

### 3.2 Componentes

| Componente | Responsabilidade |
|------------|------------------|
| `sessao_prestacao` (DB) | Contexto UF, tipo prestador, diretório, exercício, status sessão |
| `diretorio_municipal` (DB) | Cadastro mestre município + CNPJ prestador |
| `ingest` (core) | Excel, PDF, OFX → `movimentacao` + `arquivo_ingestao` |
| `match/ai` (core) | Cliente Kimi estruturado; persiste score e justificativa |
| `export` (core) | XML triplo, XSD, Excel espelho, templates oficiais |
| `apps/web` | Wizard, kanban, admin municipal, APIs REST |
| `packages/spca` | Validação XSD (inalterada em papel) |

### 3.3 Prestador e CNPJ no export

- **Estadual:** `nrCnpjPrestador` = `diretorio_estadual.cnpj_prestador` da UF.
- **Municipal:** `nrCnpjPrestador` = `diretorio_municipal.cnpj_prestador` selecionado.
- Filtros de export e `canExport`: `(tipo_prestador, diretorio_id, exercicio)` — não apenas `(uf, exercicio)` quando municipal.

---

## 4. Modelo de dados

### 4.1 `diretorio_municipal` (nova)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `uf` | varchar(2) | FK lógica à UF |
| `codigo_ibge` | varchar(7) | Opcional mas recomendado |
| `nome_municipio` | varchar(255) | |
| `cnpj_prestador` | varchar(14) | Único por prestador |
| `ativo` | boolean | default true |
| `created_at` / `updated_at` | timestamp | |

Índices: `(uf, ativo)`, unique `(cnpj_prestador)`.

### 4.2 `sessao_prestacao` (nova)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | uuid | PK |
| `uf` | varchar(2) | |
| `tipo_prestador` | enum | `ESTADUAL`, `MUNICIPAL` |
| `diretorio_estadual_id` | uuid? | Obrigatório se ESTADUAL |
| `diretorio_municipal_id` | uuid? | Obrigatório se MUNICIPAL |
| `exercicio` | int | 2024, 2025, … |
| `status` | enum | `ABERTA`, `EM_PROCESSAMENTO`, `ENCERRADA` |
| `created_by` | uuid? | `usuario.id` quando auth disponível |
| `created_at` / `updated_at` | timestamp | |

### 4.3 Alterações em tabelas existentes

**`arquivo_ingestao`**

- `sessao_prestacao_id` uuid nullable (FK).

**`movimentacao`**

- `sessao_prestacao_id` uuid nullable.
- `tipo_prestador` varchar — `ESTADUAL` | `MUNICIPAL`.
- `diretorio_municipal_id` uuid nullable.
- Manter `uf` + `exercicio` para índices e compatibilidade.
- Dedup: `hash_movimento` passa a incluir `cnpj_prestador` (estadual ou municipal) além dos campos atuais; índice unique `(cnpj_prestador, exercicio, hash_movimento)`.

### 4.4 `match_evidencia` — tipos adicionais

| Tipo | Uso |
|------|-----|
| `IA_MESMO_EVENTO` | peso conforme resposta Kimi |
| `IA_JUSTIFICATIVA` | peso 0; `detalhe` = texto livre |
| `IA_DATA_TOLERANCIA` | quando IA explica D+1 útil / feriado |
| `LACUNA_XSD` | campo obrigatório ausente |
| (existentes) `CPF_EXATO`, `VALOR_DATA`, … | Mantidos para auditoria se IA citar |

`confianca_global` na movimentação = score retornado pela IA (0–1), salvo cap por `CONFLITO` existente.

---

## 5. Pipeline IA (Kimi K2.6)

### 5.1 Entrada por movimentação

Após ingestão estruturada, enviar ao modelo:

- Campos extraídos: valor, data, hora (se houver), direção, descrição, documento, título eleitor (se houver).
- Candidatos de cadastro: PF/PJ por CPF/CNPJ extraído + busca fuzzy opcional por nome.
- Contexto: `tipo_prestador`, UF, exercício, calendário BR (feriados nacionais fixos + opcional estadual futura).
- Arquivo origem (nome; não reenviar PDF inteiro se já extraído, salvo reprocessar).

### 5.2 Saída estruturada (JSON schema)

```json
{
  "mesmo_evento": true,
  "confianca": 0.92,
  "justificativa": "string",
  "pessoa_tipo": "PF| PJ | null",
  "pessoa_documento": "11 ou 14 dígitos",
  "campos_faltantes": ["fonte_recurso", "..."],
  "evidencias": [{ "tipo": "IA_DATA_TOLERANCIA", "detalhe": "..." }]
}
```

### 5.3 Regras duras (pós-IA ou pré-bloqueio)

- CPF/CNPJ inválido (dígitos verificadores) → `bloqueio_export = true`, evidência `DOCUMENTO_INVALIDO`.
- Campos em `REQUIRED_SPCA_FIELDS` vazios → chips de lacuna; `bloqueio_export` se impedir XSD.
- Não sobrescrever `CONFIRMADO` / `EXPORTADO` sem ação humana.

### 5.4 Configuração

- `OPENROUTER_API_KEY` (obrigatório).
- `OPENROUTER_MODEL=moonshotai/kimi-k2.6`.
- Retries: 3 com backoff (como `openrouter.ts` atual).
- Timeout: 60s por chamada; para PDF bruto no ingest, manter extração dedicada se necessário antes do match.

### 5.5 Status após IA

| Condição | Status sugerido |
|----------|-----------------|
| `campos_faltantes` não vazio | `PENDENTE_REVISAO` |
| `confianca` < 0.60 | `PENDENTE_REVISAO` |
| `confianca` ≥ 0.85 e sem lacunas | `PENDENTE_REVISAO` (humano confirma no piloto) ou permitir auto `PENDENTE_REVISAO` apenas |
| Falha OpenRouter após retries | `RASCUNHO` + flag “IA indisponível” no card |

Piloto: **sempre exigir confirmação humana** para passar a `CONFIRMADO`, independente de score alto.

---

## 6. Interface (UX)

### 6.1 Wizard `/prestacao/nova`

1. UF (select).
2. Tipo: Estadual | Municipal.
3. Prestador: estadual (readonly CNPJ/nome); municipal (searchable select).
4. Exercício (select anos permitidos).
5. Anexos múltiplos (PDF, XLSX, XLS, OFX).
6. Criar sessão + upload → redirect kanban.

Design: tema claro institucional (PRODUCT.md / DESIGN.md), hierarquia Notion-like, amarelo UP só em acentos.

### 6.2 Kanban `/prestacao/[sessaoId]/kanban`

- Colunas: Rascunho | Revisão | Confirmado | Exportado; Rejeitado em coluna estreita ou ação no card.
- Card: valor, data, direção, pessoa sugerida, % confiança, chips lacunas, justificativa IA (expandível), arquivo origem.
- Agrupamento recolhível por `arquivo_ingestao`.
- Drag-and-drop com validação (não confirmar com bloqueio).
- Toolbar: confirmar lote (≥0,85), exportar SPCA, pendências CSV, ZIP pacote export.

### 6.3 Admin `/admin/diretorios-municipais`

- CRUD + importação planilha (`uf`, `codigo_ibge`, `nome_municipio`, `cnpj_prestador`).
- Restrito a perfil nacional (mesma regra de auth do piloto).

### 6.4 Dashboard

- CTA “Nova prestação”, lista sessões recentes, manter links movimentações/pessoas com contexto.

---

## 7. Export (pacote D)

Por `(sessao ou prestador, exercicio)` quando `canExport` true:

1. **XML** `origem.xml`, `aplicacao.xml`, `doacao.xml` (quando aplicável) com `nrCnpjPrestador` correto.
2. **Validação XSD** obrigatória antes de liberar download.
3. **Templates oficiais** preenchidos quando arquivos modelo estiverem em `packages/spca/templates/` (versionados).
4. **Excel espelho** com abas alinhadas aos campos XSD para auditoria interna.
5. **ZIP** único na UI com todos os artefatos + `pendencias.csv`.

---

## 8. APIs (web)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/prestacao/sessoes` | Cria sessão |
| POST | `/api/prestacao/sessoes/[id]/upload` | Upload arquivo(s) → ingest + fila IA |
| GET | `/api/prestacao/sessoes/[id]/movimentacoes` | Lista para kanban (agrupável por arquivo) |
| PATCH | `/api/movimentacoes/[id]/status` | Drag kanban / revisão |
| POST | `/api/movimentacoes/confirm` | Lote (estender com validação prestador) |
| GET | `/api/export/[prestadorTipo]/[prestadorId]/[exercicio]` | Ajustar rota export atual |
| CRUD | `/api/admin/diretorios-municipais` | Cadastro municipal |

Processamento IA: route handler dispara processamento síncrono por movimentação no piloto; se timeout Vercel, evoluir para job assíncrono com polling (`GET .../jobs/[arquivoId]`).

---

## 9. Erros e observabilidade

| Situação | Comportamento |
|----------|----------------|
| Arquivo ilegível | `arquivo_ingestao.status = ERRO`; sem movimentações órfãs |
| Kimi indisponível | 3 retries; card com badge “IA indisponível”; reprocessar botão |
| XSD inválido no export | Não publica ZIP; lista campos no UI |
| Duplicata hash | Ignorar ou marcar `REJEITADO` com log |
| Município sem cadastro | Wizard bloqueia passo 3; link para admin |

Logs: JSON estruturado; CPF/CNPJ mascarados em INFO.

---

## 10. Segurança

- Cadastro municipal e export: apenas perfil **nacional** (piloto).
- OpenRouter com dados completos (decisão C herdada); DPA documentado.
- Audit log: criar sessão, confirmar movimentação, exportar (hash pacote).

---

## 11. Testes

- Unit: schema sessão/municipal, hash dedup com prestador municipal, parse resposta Kimi.
- Integration: wizard → upload fixture → IA mock → kanban status transitions.
- Export: golden XML + XSD; snapshot Excel espelho (campos críticos).
- E2E manual: 1 UF estadual + 1 municipal homologação SPCA.

---

## 12. Fora de escopo (esta entrega)

- Perfis estaduais editando cadastro municipal.
- Upload automático ao TSE/SPCA.
- Calendário feriado municipal completo (fase 2; IA cobre justificativa no piloto).
- Kanban com colunas operacionais extras (Match/IA/Lacunas) além do status DB.
- SPCE / campanha eleitoral.

---

## 13. Migração e compatibilidade

- Movimentações antigas sem `sessao_id` permanecem no dashboard legado (`/?uf=&exercicio=`).
- `canExport` ganha variante por prestador municipal.
- Default `OPENROUTER_MODEL` alterado para `moonshotai/kimi-k2.6` em `.env.example`.

---

## 14. Próximo passo

Após aprovação deste spec: plano de implementação (`writing-plans`) em `docs/superpowers/plans/2026-05-26-fluxo-prestacao-contas.md`.
