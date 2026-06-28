---
name: prestacao-spca
description: >-
  Prestação de contas eleitorais SPCA (TSE): concilia PIX + cadastro; fonte da verdade
  SQLite (resultados/spca_revisao.db) + UI revisao_ui.py. processar_mes grava no banco;
  revisão e cadastro na web; XML via UI ou gerar_xml_origem_recurso.py. Excel só --excel.
  NLM sempre fresco. Código DB canônico em scripts/revisao_db/ do projeto. Gatilhos:
  prestação spca, processe, revisão spca, revisao ui, gerar xml spca, fora cadastro.
---

# Prestação SPCA (TSE)

**Fluxo principal: SQLite + UI** — não Excel. Ver [reference-db-ui.md](reference-db-ui.md).

| Etapa | O quê |
|-------|-------|
| Processar | `processar_mes` → grava `prontas_exportar`, `bloqueadas`, `fora_cadastro` no DB |
| Revisar | `revisao_ui.py serve` — aprovar, bloquear, cadastro (CRUD básico) |
| Exportar TSE | Botão na UI ou `gerar_xml_origem_recurso.py` (lê SQLite) |
| Planilha | Só `--excel` ou `revisao_ui.py export` — backup opcional |

**Legado:** `revisao_ui.py import` migra Excel já processado. **Drive:** fora do fluxo padrão.

Automação com pandas **interna** à conciliação (PDF/NLM → tabelas no DB). **NotebookLM obrigatório** quando a entrada é PDF.

## Três fontes

| # | Fonte | Papel |
|---|-------|-------|
| 1 | `extrato_total.pdf/.csv` | Documento base — define quais transações são doações |
| 2 | `extrato_pix.pdf/.csv` | Detalhamento dos remetentes PIX |
| 3 | `pessoas.pdf/.csv` | Cadastro (Nome, CPF/CNPJ, Tipo, Status) |

**Schema completo:** ver `references/schema.sql` (DDL canônico das 10 tabelas do SQLite).
Para mudanças de schema, criar arquivo `references/migration_NNN_<descrição>.sql`.

**Migração aditiva (jun/2026):** `references/migration_001_prestacao_unique.sql` — UNIQUE INDEX em `prestacao(estado, ano, escopo)`. Rodar antes de criar nova prestação. Backup do DB obrigatório.

## Cinco etapas (regras TSE)

| Etapa | Função | Regra |
|-------|--------|-------|
| 1 | `limpar_pessoas` | Dedup por CPF/CNPJ/nome; prioriza **Validado** + CPF mascarado `XXX.XXX.XXX-XX`; normaliza strings (maiúsculas, sem acento, espaços) |
| 2 | `filtrar_extrato_total` | `CRED PIX`, `CRED PIX CHAVE`, `PIX RECEBIDO DADOS CONTA`; demais → exceções |
| 2b | `filtrar_extrato_mes_civil` | Só linhas cuja **Data do extrato total** ∈ mês civil; PIX inteiro para parear |
| 3 | `parear_total_pix` | Chave **DDHHMM** (dia+hora+min do PIX) = `Documento` do total + **mesmo valor**; left join; nunca adivinhar se ambíguo |
| 4 | `cruzar_pessoas` | **1º nome idêntico** (só acento/caixa) + fuzzy; abreviações C/M/B no meio do cadastro; gap ≥5 no token_set |
| 5 | `exportar` | Dois Excel: sucesso + pendências |

Implementação: `scripts/conciliar_doacoes.py`

## Artefatos (SQLite vs Excel)

| Dado | Fonte da verdade | Excel |
|------|------------------|-------|
| Revisão mensal | `spca_revisao.db` (`prontas_exportar`, `bloqueadas`) | `--excel` ou `revisao_ui export` |
| Cadastro | tabela `pessoas` + UI `/cadastro` | import/export na UI |
| Fora cadastro | `fora_cadastro` no DB | gerado no `processar_mes` |
| XML TSE | `gerar_xml` lê SQLite | — |
| Revisão anual | `gerar_revisao_anual.py` (SQLite) | `--excel` |
| Exportacao_Mensal | — | só `--excel` no `processar_mes` |

Arquivos intermediários de conciliação (`Consolidado_SPCA_Sucesso.xlsx`, `Pendencias`) ainda são gerados para o pipeline interno — não são o fluxo de revisão.

Detalhes: [reference-db-ui.md](reference-db-ui.md).

## Scripts principais

| Script | Função |
|--------|--------|
| `processar_mes.py` | NLM + conciliação + Excel + rascunho revisão |
| `processar_todos.py` | Lote (só se pedido explícito) |
| `gerar_revisao_exportacao.py` | Atualiza rascunho `Revisao_Exportacao_SPCA.xlsx` |
| `finalizar_revisao_exportacao.py` | **r{n}** + XML + snapshot bloqueadas + manifesto |
| `gerar_xml_origem_recurso.py` | XML em lote (lê alias / revisão ativa) |
| `exportar_fora_cadastro.py` | Lista anual fora cadastro |
| `exportar_lista_anual.py` | Consolidado anual |
| `atualizar_cadastro_bb.py` | Inclui no cadastro TSE CPF/CNPJ do extrato BB (`cpf_extrato`) |
| `gerar_revisao_anual.py` | Consolida revisão anual (SQLite; `--excel` opcional) |
| `sincronizar.py` | **Legado** — upload Drive (fora do fluxo padrão) |
| `prestacao.py` | Configura `resultados/prestacao.json` |

Bibliotecas: `lib_diretorios.py` (CNPJ/conta), `lib_nlm.py` (PDFs), `lib_revisao_exportacao.py` (revisão), `lib_revisao_anual.py` (revisão anual), `lib_atualizar_cadastro_bb.py` (cadastro BB), `lib_xml_origem_recurso.py` (XML).

## Saída anual — revisão exportação consolidada

```bash
.venv/bin/python .cursor/skills/prestacao-spca/scripts/gerar_revisao_anual.py \
  --estado Paraíba --ano 2025 --raiz .
# Excel opcional: ... --excel
```

**Fonte:** SQLite (`gerar_revisao_anual_db`). Com `--excel`: `Revisao_Exportacao_SPCA_Anual[-{escopo}].xlsx`.

## Saída anual — lista consolidada (SQLite)

Após processar os meses (dados em `spca_revisao.db`):

```bash
.venv/bin/python .cursor/skills/prestacao-spca/scripts/exportar_lista_anual.py \
  --estado Bahia --ano 2025 --raiz .
```

Grava **`lista-anual.xlsx`** + `lista_anual_resumo.json`. `--sem-excel` só o JSON. Movimentações do extrato total usam cache `.cache/` se existir.

| Aba | Conteúdo |
|-----|----------|
| `informacoes_uteis` | Totais anuais, pendências, guia das abas |
| `resumo_mensal` | CRED PIX, sucesso, pendências e valor por mês |
| `movimentacoes_consolidadas` | Extrato total no mês civil (todas as linhas) |
| `doacoes_conciliadas` | Doações PIX com CPF validado |
| `pessoas_sem_cpf` | Doadores agregados sem CPF no cadastro |
| `entradas_nao_pix` | TED/TEV, tarifas e demais não-PIX |
| `pix_sem_par` | CRED PIX sem detalhe no extrato PIX |
| `fora_cadastro` | Pessoas ausentes ou com match parcial |

## Saída anual — pessoas fora do cadastro

Após processar os meses, gerar **`{Estado}/{ano}/pessoas_fora_cadastro.xlsx`**:

```bash
.venv/bin/python .cursor/skills/prestacao-spca/scripts/exportar_fora_cadastro.py \
  --estado Bahia --ano 2025 --raiz .
```

### Duas listas (validadas Bahia 2025)

| Lista | Aba / CSV | Critério |
|-------|-----------|----------|
| **Não consta (certeza)** | `nao_consta_certeza` / `fora_cadastro/fora_do_cadastro_definitivo.csv` | Sem match exato no cadastro; fuzzy &lt; 55%; nome completo (sem iniciais abreviadas) |
| **Precisa revisar** | `precisa_revisar` / `fora_cadastro/precisam_revisar_cadastro.csv` | Match parcial (fuzzy ≥ 55%) **ou** nome abreviado/incompleto no extrato (ex.: `JUAN B B SANTOS`, `JULIANA FREITAS M SILVA`) |

Aba **`todas`**: as duas listas unificadas com coluna **Situação**.

### Confirmação manual

Quando o diretório confirmar que um nome da lista **precisa revisar** é de fato alguém do cadastro (ex.: grafia diferente), promover para sucesso e **não** incluir em “fora cadastro”. Os demais candidatos parciais rejeitados ficam em **não consta**.

### Outras naturezas (TED/TEV)

Lançamentos **CRED TEV/TED** no extrato total sem nome no PDF não entram no fuzzy de doadores — reportar à parte (data, valor, documento) para o diretório identificar remetente.

## Paraíba — estadual + municipios

João Pessoa, Patos e Campina Grande são **prestações municipais** (PB). Todas usam o **mesmo cadastro estadual** — não criar planilha por município.

| O quê | Onde |
|-------|------|
| Cadastro TSE (único PB) | `Paraíba/cadastro/pessoas paraiba.xlsx` |
| Fontes estaduais | `Paraíba/Prestação de contas - Paraíba/` (`caixa_1`) |
| Fontes municipais | `Paraíba/municipios/{escopo}/` |

**Escopos** (`prestacao.json` → `escopo`): `joao-pessoa`, `patos`, `campina-grande`. Saídas em `Paraíba/{ano}/{escopo}/{mes}/`.

```
Paraíba/
├── cadastro/pessoas paraiba.xlsx       # ← TSE PB (estadual + todos os municipios)
├── Prestação de contas - Paraíba/      # estadual (caixa_1)
├── municipios/
│   ├── joao-pessoa/                    # caixa_1: Extrato total/, Extrato total PIX/, Planilhado/
│   ├── patos/                          # bb_unificado: Estadual/834 {abr} 2025.pdf → pdf/PB PT MM 25.pdf
│   └── campina-grande/                # Extratos/ (PDFs *CG.pdf — layout Caixa municipal)
└── 2025/
    ├── janeiro/ …                      # saídas estaduais (sem escopo)
    ├── joao-pessoa/{mes}/
    ├── patos/{mes}/
    └── campina-grande/{mes}/
```

Configurar prestação municipal:

```bash
# Patos (BB unificado, conta 834)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/prestacao.py \
  --estado Paraíba --ano 2025 --escopo patos \
  --base-prestacao "Paraíba/municipios/patos" --raiz .

# João Pessoa (caixa_1)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/prestacao.py \
  --estado Paraíba --ano 2025 --escopo joao-pessoa \
  --base-prestacao "Paraíba/municipios/joao-pessoa" --raiz .
```

**Cadastro:** exportar `pessoas paraiba.numbers` → `.xlsx` antes de processar (Numbers não é lido pelo pipeline). Colunas: `Nome`, `CPF/CNPJ`, `Tipo de Pessoa`, `Status`.

## Regras fixas

| Regra | Valor |
|-------|-------|
| NLM | **Sempre fresco** — `limpar_cache_nlm()` antes de cada extração |
| NotebookLM | 1 notebook por **UF + ano + mês**: `SPCA-V2-{UF}-{ano}-{Mês}` (ex. `SPCA-V2-BA-2025-Janeiro`) |
| `--pular-nlm` | **Só debug** — nunca usar em `processe {mês}` |
| PIX | **NLM do PDF** tem prioridade; planilhado só se NLM PIX vazio |
| Lote | Somente se usuário pedir `processe todos` |
| Pareamento / fuzzy ambíguo | **Nunca adivinhar** — vai para pendências |
| Mês civil | **Data do extrato total** (crédito na conta); não pasta PDF nem data PIX |
| Consolidadas | Só linhas do **extrato total**; PIX detalhe não conta como movimentação extra |
| Vazamento PDF | Linhas fora do mês excluídas; **sem arquivo** se 100% no mês efetivo |
| 1º nome | **Sempre igual** após `normalize_text` — sem abreviação (`M` ≠ `MARIA`) |
| Sobrenome (resgate &lt;85%) | Último token igual ou abreviado (`S` = `SILVA`) |
| Homônimos no cadastro | **Não** fundir só por `nome_norm` igual — só duplicata Validar+Validado |
| `diretorios.xlsx` | **Sempre** preencher CNPJ prestador + conta bancária a partir do extrato total (texto ou **1 query NLM** no cabeçalho se escaneado); só células vazias — nunca sobrescrever manual |
| Exportação r{n} | **`r{n}` só em `finalizar_revisao_exportacao.py`** — r1 = 1º XML; r2+ = após resolver bloqueados; alias `Revisao_Exportacao_SPCA.xlsx` = último r{n} |

## Aprendizados — Bahia 2025 (sessão)

| Lição | Detalhe |
|-------|---------|
| NLM sempre fresco | `limpar_cache_nlm()` — nunca `--pular-nlm` em `processe {mês}` |
| PIX = NLM, não planilhado | Planilhado pode ter **data errada** (ex. 01/01 vs 02/01) → 10+ `PIX sem par` |
| Históricos doação | Incluir `CRED PIX CHAVE` e `PIX RECEBIDO DADOS CONTA` — não são tarifa |
| `TAR PIX` | Tarifa pareada à doação — correto em **Não PIX**, não conciliar |
| Pareamento | Chave **DDHHMM + valor** (não só datetime do total) |
| Falso positivo evitado | `IASMIN` ≠ `VINICIUS` mesmo com `partial_token_set` 100% — **1º nome obrigatório** |
| CPF pendente típico | Doador **ausente** no cadastro (254 pessoas); abreviação RF (`JUAN B B`) não resolve sem cadastro |
| Cadastro abreviado | ~41 linhas com `C`, `M`, `B` no meio — `token_abrev_cadastro` (70–84%) quando PIX traz nome completo |
| Vitoria duplicata | Duas linhas Validar/Validado — `consolidar_por_nome_identico` só se duplicata, não homônimos |
| Alias coluna PIX | `Remetente/Destinatario` em `COLUMN_ALIASES` |
| Abril multi-PDF | 2 PDFs PIX → risco `PIX sem par` se NLM omitir linha |
| Consolidadas ≠ NLM | NLM soma total+PIX (ex. 223); consolidadas = só extrato total no mês civil |
| Vazamento fronteira | PDF nov com 153 linhas mas **139** em nov/2025; 14× `01/12` → dezembro |
| Dia total ≠ PIX | Fim de semana: crédito seg no total, PIX sáb — parear por **DDHHMM+valor** |
| Tarifas | `TAR PIX`, `MANUT`, `DEB PIX CHAVE` — saída; não é doação |
| Dup. cadastro | Duplicata em `pessoas` — corrigir no xlsx; **não** soma em consolidadas |
| Benchmark | Jan: **31/34** (91%) · Abr: **45/66** (68%) — abr mais doadores novos |
| PDF escaneado (Caixa) | Cabeçalho sem texto → `extrair_cabecalho_conta()` via NLM preenche `diretorios.xlsx` |
| Exportação r1 | Bloqueadas vão para snapshot + banco anual; alias fica elegível para XML |
| Exportação r2+ | Reprocessar mês após tratar `banco_bloqueadas.xlsx` → novo pacote r{n} |
| BB cadastro extrato | `atualizar_cadastro_bb` → `processar_todos --forcar --pular-nlm` — senão meses posteriores repetem `documento fora do cadastro` |
| Patos mar/2025 | Fev aprovado (12) · mar bloqueado (11) antes do cadastro — 13 CPFs do extrato adicionados; março → 11 sucesso |

Ver armadilhas completas: [reference.md](reference.md#lições-e-armadilhas--bahia-2025).

## Pré-requisitos

```bash
python3 -m venv .venv
.venv/bin/pip install -r .cursor/skills/prestacao-spca/requirements.txt
nlm doctor
export NLM_QUERY_TIMEOUT=300
```

Drive (legado, opcional): ver [reference.md](reference.md).

## Testes

```bash
.venv/bin/python -m pytest                    # roda todos (~25 tests)
.venv/bin/python -m pytest tests/test_tse_io.py -v   # 1 arquivo
.venv/bin/python -m pytest -k "validar"       # por nome
```

Cobertura atual:
- `test_tse_io.py` — encoding CSV/XML, raiz SSD
- `test_load_constants.py` — CNPJs por estado, defaults XML, fuzzy
- `test_with_backup.py` — backup antes de mutação, restore em falha
- `test_validar_xml_antes_envio.py` — pre-XML validator (encoding, namespace, CNPJ, campos obrigatórios)
- `test_fechar_anual.py` — swap+restore de prestacao.json

Setup: `pytest.ini` em raiz, `tests/conftest.py` adiciona `scripts/` ao sys.path.

## Setup (uma vez por prestação)

```bash
cd "/Volumes/SSDdoMarcos/Projetos/SPC UP - Verificar pessoas"

.venv/bin/python .cursor/skills/prestacao-spca/scripts/prestacao.py \
  --estado Bahia --ano 2025 --raiz .
```

## Processar um mês

```bash
.venv/bin/python .cursor/skills/prestacao-spca/scripts/processar_mes.py janeiro \
  --estado Bahia --ano 2025 --raiz .
```

Fluxo completo:

```
processar_mes → SQLite (prontas, bloqueadas, fora_cadastro, cadastro)
revisao_ui serve → aprovar (aprovado=S)
gerar_xml → exportacao/*.xml
```

`processar_mes`: NLM → conciliação → `spca_revisao.db`. `--excel` gera planilhas legado.

## Google Drive (legado)

Fora do fluxo padrão. Comandos: `sincronizar.py`, `scripts/sync_estrutura_drive.py`. Detalhes em [reference.md](reference.md).

## Modelos de extrato

| `modelo_extrato` | Layout | Estados |
|------------------|--------|---------|
| `caixa_1` (padrão) | Extrato total + extrato PIX separados · `CRED PIX` · DDHHMM+valor | Bahia |
| `bb_unificado` | 1 PDF/mês (`Estadual/`) · `Pix - Recebido` · nome na mesma linha | Santa Catarina |

Alias legado: `bahia` → `caixa_1` (em `prestacao.json` antigo).

BB unificado: CPF da linha de detalhe → `cpf_extrato`; match exato no cadastro antes do fuzzy. Se o documento do extrato **não está** em `pessoas {estado}.xlsx`, a linha vai para pendências (`documento fora do cadastro`) mesmo que tenha sido aprovada manualmente em outro mês.

### Cadastro a partir do extrato BB (`bb_unificado`)

Quando o CPF/CNPJ não está no cadastro TSE mas aparece em `CPF_extrato` nas pendências:

```bash
# Dry-run
.venv/bin/python .cursor/skills/prestacao-spca/scripts/atualizar_cadastro_bb.py \
  --dry-run --estado Paraíba --ano 2025 --raiz .

# Grava em pessoas {estado}.xlsx (backup automático)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/atualizar_cadastro_bb.py \
  --estado Paraíba --ano 2025 --raiz .

# Reconciliar meses já processados (cadastro mudou; NLM inalterado)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/processar_todos.py \
  --forcar --pular-nlm --raiz .
```

Ordem recomendada **Patos / SC / demais BB**:

1. `processar_mes` (ou lote) de todos os meses  
2. `atualizar_cadastro_bb` — deduplica por documento, acrescenta `Validado`  
3. `processar_todos --forcar --pular-nlm` — reaplica conciliação sem novo NLM  
4. `gerar_revisao_anual` + `exportar_lista_anual` + `exportar_fora_cadastro`

**Armadilha:** mês processado **antes** do passo 2 mostra falsos `CPF Ausente (documento fora do cadastro)` para doadores já aprovados em meses anteriores (ex. fevereiro OK, março bloqueado). Corrigir com passos 2–3, não editar planilha à mão.

Implementação: `lib_atualizar_cadastro_bb.py` · lê `Pendencias_e_Inconsistencias.xlsx` com `CPF_extrato` + categoria/motivo `CPF Ausente` ou `fora do cadastro`.

## Exportação SPCA — origemRecurso (XML)

### Cadastro de diretórios

Planilha na **raiz do projeto**: `diretorios.xlsx` (aba `diretorios`).

| Coluna | Descrição |
|--------|-----------|
| `cnpj_prestador` | CNPJ do diretório prestador (14 caracteres TSE) |
| `nome_diretorio` | Nome legível / razão social do titular da conta |
| `estado_uf` | UF (ex. BA, SC) |
| `ano` | Ano exercício |
| `nr_banco`, `agencia`, `dv_agencia`, `conta`, `dv_conta` | Conta destino PIX |
| `observacoes` | Notas |

**Preenchimento automático (obrigatório em todo `processar_mes`):**

Ao gerar `Revisao_Exportacao_SPCA.xlsx`, `atualizar_banco_de_pdfs()` em `lib_diretorios.py`:

1. Lê o **extrato total** do mês (PDF com texto, via pymupdf).
2. Se o PDF for **escaneado** (sem camada de texto), faz **1 query NotebookLM** no cabeçalho (`extrair_cabecalho_conta()` em `lib_nlm.py`) usando o `notebook_id` do mês.
3. Preenche em `diretorios.xlsx` **somente células vazias** da linha UF+ano: `cnpj_prestador`, `nome_diretorio`, `nr_banco`, `agencia`, `dv_agencia`, `conta`, `dv_conta`.
4. Valores já preenchidos manualmente **nunca são sobrescritos**.

Implementação: `lib_diretorios.py` · prompt NLM: `_prompt_cabecalho_extrato()` · chamado de `gerar_revisao_mes()` (via `processar_mes` ou `gerar_revisao_exportacao.py`).

Vínculo na exportação XML: `resultados/prestacao.json` → `cnpj_prestador` (opcional) · fallback match bancário no extrato · único diretório UF+ano.

### Defaults XML (fixos no código)

| Campo | Valor |
|-------|-------|
| `fonteRecurso` | `OR` |
| `naturezaRecurso` | `0` (financeiro) |
| `classificacaoReceita` | `320` (outras contribuições) |
| `nrExtratoBancario` | `Documento` / identificador da transação no extrato |

### Versionamento da exportação (estado / ano / mês / r{n})

O sufixo **`r{n}`** nasce somente em `finalizar_revisao_exportacao.py` (1ª exportação XML = **r1**; nova rodada após resolver bloqueados do banco = **r2**, …).

| Artefato | Rascunho (pré-finalizar) | Finalizado r{n} |
|----------|--------------------------|-----------------|
| Revisão | `Revisao_Exportacao_SPCA.xlsx` (alias editável) | `Revisao_Exportacao_SPCA-r{n}.xlsx` + alias espelha o último r{n} |
| XML | — | `{estado}-{ano}-{mes}-r{n}-origemRecurso.xml` |
| Bloqueadas | aba `bloqueadas` na revisão | `{estado}-{ano}-{mes}-r{n}-bloqueadas.xlsx` (snapshot imutável) |
| Manifesto | — | `{Estado}/{ano}/{mes}/revisao/revisao_exportacao.json` (`ativa`, histórico) |
| Fila anual | — | `{Estado}/{ano}/bloqueadas/banco_bloqueadas.xlsx` (coluna `revisao_n`) |

Exemplo janeiro r1:

```
Bahia/2025/janeiro/revisao/Revisao_Exportacao_SPCA-r1.xlsx
Bahia/2025/janeiro/revisao/Revisao_Exportacao_SPCA.xlsx          ← alias = r1
Bahia/2025/janeiro/revisao/revisao_exportacao.json
Bahia/2025/exportacao/bahia-2025-janeiro-r1-origemRecurso.xml
Bahia/2025/bloqueadas/bahia-2025-janeiro-r1-bloqueadas.xlsx
Bahia/2025/bloqueadas/banco_bloqueadas.xlsx
```

Próximo `n`: manifesto (`revisao_exportacao.json`) + scan de `-r*.xml` / `-r*.xlsx` como fallback.

### Fluxo

1. `processar_mes` → conciliação + rascunho `Revisao_Exportacao_SPCA.xlsx` (sem r{n})  
2. Conferir `prontas_exportar` (`aprovado=S`)  
3. `finalizar_revisao_exportacao.py` → **r{n}** + XML + snapshot bloqueadas + manifesto  
4. Tratar pendências em `banco_bloqueadas.xlsx`; reprocessar mês se necessário → `finalizar` de novo → **r{n+1}**

Reprocessar mês: merge inteligente no rascunho — `aprovado=S` preservado se linha inalterada (chave data+valor+documento+CPF).

### Comandos

```bash
# Rascunho de revisão (sem r{n}, bloqueadas ainda na aba)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/gerar_revisao_exportacao.py \
  janeiro --estado Bahia --ano 2025 --raiz .

# Finalizar: aprova prontas, arquiva bloqueadas r{n}, gera XML r{n}
.venv/bin/python .cursor/skills/prestacao-spca/scripts/finalizar_revisao_exportacao.py \
  janeiro --estado Bahia --ano 2025 --raiz .

# Configurar CNPJ ativo manualmente (opcional)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/prestacao.py \
  --estado "Santa Catarina" --ano 2025 --cnpj-prestador SEU_CNPJ --raiz .

# XML em lote (lê alias / revisão ativa por mês)
.venv/bin/python .cursor/skills/prestacao-spca/scripts/gerar_xml_origem_recurso.py \
  --meses janeiro,marco --estado Bahia --ano 2025 --raiz .
```

Mês elegível para XML: todas `prontas_exportar` com `aprovado=S` **e** aba `bloqueadas` vazia (bloqueadas arquivadas em r{n}).

---

## Árvore de pastas (layout A)

```
SPCA UP V2/
  diretorios.xlsx
  resultados/
    prestacao.json
    drive_manifest.json
  Bahia/
    cadastro/pessoas bahia.xlsx
    fontes/                              # ← PDFs planos (entrada)
      2025-janeiro-total.pdf
      2025-janeiro-pix.pdf
    2025/
      lista-anual.xlsx
      pessoas_fora_cadastro.xlsx
      exportacao/
        bahia-2025-janeiro-r1-origemRecurso.xml
      bloqueadas/
        banco_bloqueadas.xlsx
      mensal/                            # ← saídas (um arquivo por mês)
        janeiro-Exportacao_Mensal.xlsx   # arquivo principal para conferir
        janeiro-Consolidado_SPCA_Sucesso.xlsx
        janeiro-Revisao_Exportacao_SPCA.xlsx
        janeiro-resumo.json
        .cache/janeiro/
```

**Convenção de nomes em `fontes/`:** `{ano}-{mes}-total.pdf`, `{ano}-{mes}-pix.pdf` (ou `jan`, `648 jan 2025.pdf` para BB).

**Legado:** `Prestação de contas - {Estado}/Extrato total/{Mês}/` e `{ano}/{mes}/` ainda são lidos; novas saídas vão para `mensal/`.

Migrar saídas antigas: `scripts/migrar_layout_mensal.py --estado Bahia --ano 2025 --raiz .`

## Gatilhos no chat

| Usuário diz | Ação |
|-------------|------|
| `processe janeiro bahia` | `processar_mes.py janeiro --estado Bahia --ano {ano} --raiz .` |
| `processe todos` | `processar_todos.py` (explícito) |
| `fora cadastro` / `lista diretório` | `exportar_fora_cadastro.py` |
| `revisão anual` / `revisao anual patos` | `atualizar_cadastro_bb` → `processar_todos --forcar --pular-nlm` → `gerar_revisao_anual.py` |
| `atualizar cadastro bb` / `cpf do extrato` | `atualizar_cadastro_bb.py` |
| `status` | `prestacao.json` + `{Estado}/{ano}/status.json` |
| `pendências janeiro` | `Pendencias_e_Inconsistencias.xlsx` |
| `revisão exportação janeiro` | `gerar_revisao_exportacao.py janeiro …` (rascunho) |
| `finalizar exportação janeiro` | `finalizar_revisao_exportacao.py janeiro …` (r{n}+XML) |
| `gerar exportação janeiro` / `gerar arquivo spca janeiro` | `finalizar_revisao_exportacao.py janeiro …` |
| `gerar xml spca` | `gerar_xml_origem_recurso.py` (lote; preferir `finalizar` por mês) |
| `sincronizar` / `sync drive` / `subir pro drive` | `sincronizar.py --raiz .` |
| `sincronizar janeiro` / `sync janeiro drive` | `sincronizar.py janeiro --raiz .` |
| `status drive` | `sincronizar.py --mostrar --raiz .` |

Antes do 1º mês: confirmar estado/ano se `prestacao.json` ausente.

## Resposta no chat (template mensal)

Ler `{Estado}/{ano}/{mes}/resumo.json`:

```markdown
## {Mês} — conciliação SPCA
**Prestação:** {estado} ({estado_uf}) · **{ano}**

- CRED PIX: **{cred_pix}** · Sucesso: **{sucesso}** · Pendências: **{pendencias}**
- Consolidadas: **{linhas_mes}** (PDF **{linhas_pdf}**, vazamento **{linhas_vazamento}**)
- NLM: **{nlm.transacoes}** transações · fonte PIX: {meta.fonte_pix}
- Arquivos:
  - `{path_sucesso}`
  - `{path_pendencias}`
```

## Resposta no chat (template exportação r{n})

Ler `{Estado}/{ano}/{mes}/revisao/revisao_exportacao.json` e manifesto:

```markdown
## {Mês} — exportação SPCA r{n}
**Prestação:** {estado} ({estado_uf}) · **{ano}**

- Revisão ativa: **r{ativa}** · Aprovadas: **{aprovadas}** · Bloqueadas arquivadas: **{arquivadas}**
- Arquivos:
  - `{revisao}` (alias: `Revisao_Exportacao_SPCA.xlsx`)
  - `{xml}`
  - `{bloqueadas_snapshot}`
  - Fila anual: `{Estado}/{ano}/bloqueadas/banco_bloqueadas.xlsx`
- Próximo passo: tratar pendências no banco → reprocessar → `finalizar` → r{n+1}
```

## Resposta no chat (template anual — fora cadastro)

Ler `{Estado}/{ano}/fora_cadastro/resumo.json` e abas de `pessoas_fora_cadastro.xlsx`:

```markdown
## Pessoas fora do cadastro — {estado} {ano}

Cruzamento com `{cadastro}` após todos os meses processados.

| Situação | Qtd |
|----------|-----|
| Não consta (certeza) | {fora_cadastro_certeza} |
| Precisa revisar (aproximação/abreviado) | {precisam_revisar} |
| **Total** | {total_fora} |

Arquivo: `{Estado}/{ano}/pessoas_fora_cadastro.xlsx`

**Precisa revisar:** incluir candidato sugerido (nome + CPF) quando houver match parcial.
**Não consta:** solicitar nome completo e CPF para inclusão no cadastro.
```

## Pitfall: `cnpj_prestador` errado no `prestacao.json` gera transações de outro diretório

Caso real (PB 2025 jun/2026): `prestacao.json` da prestação Campina Grande
tinha `cnpj_prestador=36734940000151` (CNPJ de João Pessoa). O
`resolver_diretorio` em `lib_diretorios.py` achou 1 match em `diretorios.xlsx`
para esse CNPJ (a linha de JP) e gravou transações de janeiro/maio com
`nome_diretorio=PARAIBA - JOÃO PESSOA (CAIXA)` e agência/conta de JP, dentro
de uma prestação que é de Campina Grande.

**Por que passou batido:**
- `diretorios.xlsx` tem várias linhas PB (Estadual, JP, CG) mas só algumas
  têm CNPJ preenchido.
- O CNPJ errado bateu com **exatamente 1** linha → match silencioso, sem
  erro.

**Defesa automática** (jun/2026): se a UF tem **mais de 1 diretório
cadastrado** em `diretorios.xlsx`, `resolver_diretorio` agora **NÃO confia
só no CNPJ**. Exige `conta_extrato` (banco+agência+conta) e, na falta,
levanta erro explícito listando os candidatos.

```bash
# conferir CNPJ de cada diretório PB em diretorios.xlsx
.venv/bin/python -c "
import openpyxl
wb = openpyxl.load_workbook('diretorios.xlsx')
ws = wb['diretorios']
for row in ws.iter_rows(values_only=True):
    if row[2] == 'PB':
        print(f'{row[0]:18} {row[1]}')
"
```

**Sinais de problema:** transações de uma prestação com `nome_diretorio`
de outra prestação do mesmo estado, ou com `agencia/conta` que não bate
com o PDF do extrato da prestação atual.

**Como conferir/atualizar CNPJ do diretório:**

```bash
# 1) conferir o CNPJ real de cada diretório
.venv/bin/python -c "import openpyxl; wb=openpyxl.load_workbook('diretorios.xlsx'); ws=wb['diretorios']; [print(r[0], r[1]) for r in ws.iter_rows(values_only=True) if r[2]=='PB']"

# 2) conferir o que está no prestacao.json da prestação ativa
cat resultados/prestacao.json | python3 -m json.tool | grep cnpj_prestador
```

**Antes de gerar revisão anual ou XML**, conferir se todas as transações
de `prontas_exportar` têm `nome_diretorio` da prestação certa (não de
outro diretório do mesmo estado). SQL de checagem:

```sql
SELECT DISTINCT pe.nome_diretorio, pe.agencia, pe.conta, COUNT(*)
FROM prontas_exportar pe
JOIN mes m ON pe.mes_id=m.id
JOIN prestacao p ON m.prestacao_id=p.id
WHERE p.escopo='<escopo>' AND p.estado='<estado>' AND p.ano=<ano>
GROUP BY pe.nome_diretorio;
```

## Pitfall: `status.json` desatualizado em relação ao DB

**Use `scripts/status_from_db.py` para derivar status atual do SQLite.**

```bash
.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/status_from_db.py --uf BA --ano 2025
.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/status_from_db.py --uf BA --ano 2025 --json
```

`status.json` é mantido apenas para retrocompatibilidade de scripts legados.

## Defesa Contra `extrato_pix vazio` (tipo sem "pix")

Se o NLM rotular transações do extrato PIX apenas como `"RECEBIDO"`, a regra estrita de `"pix" in tipo` as descartaria.
A regra foi atualizada para ser **robusta**: se a transação veio de um arquivo de origem que contém `"pix"` no nome do arquivo (ex: `2025-janeiro-pix.pdf`), e não é de saída (`is_saida=False`), ela é classificada como **PIX Recebido** mesmo sem a palavra "pix" no histórico/tipo.

## Referência

Regras completas, classificação fora cadastro e schemas: [reference.md](reference.md)
