# Fluxo SQLite + UI (fonte da verdade)

Arquitetura alvo acordada para substituir Excel como meio do fluxo. Excel vira **export opcional** (`--excel`).

## Decisões

| Tópico | Decisão |
|--------|---------|
| Fonte da verdade | `resultados/spca_revisao.db` |
| `processar_mes` grava | `prontas_exportar`, `bloqueadas`, `fora_cadastro` |
| Código canônico DB | `{raiz}/scripts/revisao_db/` (projeto importa skill; skill grava no projeto) |
| Revisão humana | UI Flask `scripts/revisao_ui.py serve` |
| XML TSE | UI (botão) + CLI `gerar_xml_origem_recurso.py` — lê SQLite |
| Excel | Só com `--excel` ou export explícito na UI |
| Cadastro | Híbrido: import Excel → tabela `pessoas`; CRUD básico na UI; export opcional |
| Consolidados anuais | Query SQL; arquivo só com `--excel` |
| Drive | **Fora do fluxo** — não usar `sync_drive` / `sincronizar` por padrão |
| Migração legado | `revisao_ui.py import` (lê `Revisao_Exportacao_SPCA.xlsx` existente) |
| Revisão online | Mantém Basic Auth + cloudflared — ver `docs/revisao-online.md` |

## Fluxo mensal (alvo)

```
PDFs/NLM → processar_mes → SQLite
                ↓
         revisao_ui serve (aprovar / bloquear / fora cadastro)
                ↓
    gerar_xml (UI ou CLI) → exportacao/*.xml
                ↓
         --excel (opcional) → planilhas para backup/equipe
```

## Comandos

```bash
cd "{raiz}"

# 1. Configurar prestação
.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/prestacao.py \
  --estado Bahia --ano 2025 --raiz .

# 2. Processar mês → SQLite (default)
.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/processar_mes.py janeiro \
  --estado Bahia --ano 2025 --raiz .

# 2b. Com planilhas (legado / backup)
# ... processar_mes.py ... --excel

# 3. UI revisão
.venv/bin/python scripts/revisao_ui.py --raiz . serve
# http://127.0.0.1:8765

# 4. XML (após aprovação na UI)
.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/gerar_xml_origem_recurso.py \
  --estado Bahia --ano 2025 --raiz .

# Migração Excel → DB (uma vez por prestação legada)
.venv/bin/python scripts/revisao_ui.py --raiz . import

# Export opcional Excel
.venv/bin/python scripts/revisao_ui.py --raiz . export

# Finalizar revisão do mês (r{n}) — após aprovar prontas na UI
.venv/bin/python scripts/revisao_ui.py --raiz . finalizar --mes janeiro

# Backfill extrato_linha (meses legados com .cache/fontes.json)
.venv/bin/python scripts/revisao_ui.py --raiz . backfill-extrato
```

## Schema SQLite (existente + planejado)

**Já em `scripts/revisao_db/db.py`:**

- `prestacao` — estado, ano, escopo, pasta
- `mes` — slug, stats, `elegivel_xml`
- `prontas_exportar` — linhas aprovadas para XML
- `bloqueadas` — pendências do mês
- `fora_cadastro` — decisões anuais de cadastro

**Feito (cadastro híbrido + anuais + trilha XML):**

- `pessoas` — `estado`, `ano`, `nome`, `cpf_cnpj`, `tipo_pessoa`, `status`; CRUD na UI; `incluir_cadastro` em fora_cadastro propaga via `aplicar_decisao_fora_cadastro`
- `extrato_linha` — movimentações tabulares por mês; `_persist_extrato_db` em `gravar_mes_db`; backfill: `backfill-extrato`
- `exportacao_xml` — histórico `r{n}` por mês (`mes_id`, `revisao_n`, `path`, `origens`, `gerado_em`)

## Integração skill → projeto

`processar_mes.py` deve:

1. Conciliar (pandas interno — OK, não é artefato do fluxo)
2. Gravar direto via `scripts/revisao_db/sync.py` (função dedicada `gravar_mes_db`, sem passar por Excel)
3. Gerar `resumo.json` + atualizar `status.json` como hoje
4. Só chamar `lib_revisao_exportacao` se `--excel`

`gerar_xml_origem_recurso.py` / `lib_xml_origem_recurso.py` devem:

1. Ler `prontas_exportar` + `bloqueadas` do SQLite
2. Aplicar `mes_elegivel_xml` (lógica existente, aceitar `list[dict]` em vez de DataFrame)

## UI

- Lazy-import `sync` só em rotas `import`/`export` — `serve` sobe sem pandas
- Botão **Gerar XML** chama mesma lib do CLI
- Aba cadastro: listar, buscar, editar nome/CPF/tipo/status

## Legado Excel (não deletar referência)

| Artefato antigo | Papel novo |
|-----------------|------------|
| `Revisao_Exportacao_SPCA.xlsx` | Export opcional; `import` para migração |
| `Exportacao_Mensal.xlsx` | Export opcional (`--excel`) |
| `lista-anual.xlsx` | Query SQL + `--excel` |
| `pessoas {estado}.xlsx` | Import inicial + export cadastro |

## Implementação (ordem)

1. ~~`gravar_mes_db`~~ **feito**
2. ~~Lazy-import `app.py`~~ **feito**
3. ~~`gerar_xml` SQLite + API~~ **feito**
4. ~~`fora_cadastro` no `gravar_mes_db`~~ **feito**
5. ~~Tabela `pessoas` + UI cadastro~~ **feito**
6. ~~Anuais via SQL (`anuais.py`)~~ **feito**
6b. ~~`lista-anual` via SQL (`lista_anual.py`)~~ **feito** — `extrato_linha` no SQLite (`coletar_movimentacoes_ano_db`); backfill: `revisao_ui.py backfill-extrato`
7. ~~`Exportacao_Mensal` só `--excel`~~ **feito**
8. ~~Docs + SKILL.md~~ **feito**

### Fases 3–4 (produção)

**Fase 3 — fora cadastro → `pessoas`:** `POST /api/fora-cadastro` com `decisao=incluir_cadastro` chama `aplicar_decisao_fora_cadastro` em `sync.py`; nova linha visível em `/cadastro` sem export/import Excel.

**Fase 4 — trilha XML `r{n}`:** `finalizar_mes_db` arquiva bloqueadas com `ignorar_exportacao=S`, incrementa `mes.revisao_atual`; botão **Finalizar r{n}** na UI (`POST /api/finalizar-mes`) e CLI `revisao_ui.py finalizar --mes {slug}`; `gerar_xml` registra em `exportacao_xml` com sufixo `-r{n}`.
