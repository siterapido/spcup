# Referência — Conciliar doações SPCA

Regras de negócio completas para regeneração ou adaptação do script.

---

## Fontes de entrada

### extrato_total (.csv / .xlsx)

Documento base de movimentação bancária.

| Coluna lógica | Descrição |
|---------------|-----------|
| `data_total` | Data da transação |
| `valor_total` | Valor monetário |
| `documento_total` | Número formado por DDHHMM (dia + hora + minuto) |
| `historico_total` | Tipo da transação (filtrar `CRED PIX`) |

### extrato_pix (.csv / .xlsx)

Detalhamento dos remetentes PIX.

| Coluna lógica | Descrição |
|---------------|-----------|
| `data_pix` | Data da transação |
| `hora_pix` | Hora (HH:MM ou HHMM) |
| `valor_pix` | Valor |
| `nome_pix` | Nome do remetente (Receita Federal / banco) |

### pessoas (.csv / .xlsx)

Cadastro manual de doadores.

| Coluna lógica | Descrição |
|---------------|-----------|
| `nome_pessoa` | Nome completo ou razão social |
| `cpf_pessoa` | CPF (com ou sem máscara) — pode conter CNPJ se coluna única |
| `cnpj_pessoa` | CNPJ (opcional, coluna separada) |
| `tipo_pessoa` | PF / PJ |
| `status_pessoa` | Validado / Validar / etc. |

---

## Etapa 1 — Pré-processamento pessoas

### Normalização de strings

Aplicar em **todas** as bases antes de qualquer cruzamento:

1. Converter para maiúsculas
2. Remover acentos (NFKD)
3. Colapsar espaços múltiplos
4. Strip leading/trailing

**Não** tentar separar nomes colados automaticamente (ex.: `VANESSAANUNCIACAO SILVA`). O fuzzy matching + revisão manual cobrem esses casos.

### Deduplicação

**Chave de agrupamento** (em ordem):

1. Dígitos do CPF (11) ou CNPJ (14), se presente
2. Nome normalizado, se documento ausente

**Prioridade dentro do grupo** (maior vence):

| Critério | Pontos |
|----------|--------|
| Status contém `VALIDADO` | 2 |
| Status contém `VALIDAR` | 1 |
| CPF mascarado `XXX.XXX.XXX-XX` | 2 |
| CPF só dígitos (11) | 1 |
| CNPJ mascarado | 2 |
| CNPJ só dígitos (14) | 1 |
| Completude (nome + docs preenchidos) | desempate |

Duplicatas descartadas vão para pendências com motivo explícito.

**Segunda passagem** — `consolidar_por_nome_identico`: ver Etapa 4 (só duplicata, não homônimos).

---

## Etapa 2 — Filtragem extrato total

1. Normalizar coluna `Histórico`:
   - Uppercase, sem acentos
   - Remover pontuação
   - Colapsar espaços
2. Manter linhas onde histórico normalizado está em:
   - `CRED PIX`
   - `CRED PIX CHAVE`
   - `PIX RECEBIDO DADOS CONTA`
3. Restante → dataframe de exceções

Variantes como `Crédito PIX` ou `CRED.PIX` **não** passam (match exato pós-normalização na lista acima).

---

## Etapa 3 — Pareamento total ↔ PIX (chave DDHHMM)

### Chave de ligação

O campo `Documento` do extrato total = **DD + HH + MM** da transação no extrato PIX.

Exemplo: PIX em 02/01/2025 às 07:57 → `Documento` = `020757`.

### Algoritmo (left join)

1. No extrato PIX, calcular coluna `ddhhmm` = `f"{dia:02d}{hora:02d}{minuto:02d}"` a partir de `Data` + `Hora`
2. Normalizar `Documento` do total para 6 dígitos
3. Para cada linha CRED PIX do total:
   - Filtrar PIX com `ddhhmm == documento` **e** `valor` idêntico (2 casas)
   - **1 candidato** → pareado (`Par_PIX_metodo`: `DDHHMM+valor`)
   - **0 candidatos** → fallback HHMM+valor com data ±1 dia e tolerância ±3 min
   - **>1 candidato** → pendência `PIX sem par` (par ambíguo — nunca adivinhar)
4. Cada linha PIX só pode parear uma vez

### Prioridade da fonte PIX

1. Transações NLM dos PDFs em `Extrato total PIX/{Mês}/`
2. `Planilhado/{Mês}/*.xlsx` — **somente** se NLM PIX retornar vazio

---

## Etapa 4 — Fuzzy matching (multi-camada, conservador)

### Normalização prévia

`normalize_text` em PIX e cadastro: maiúsculas, sem acento, espaços colapsados.

### Dedup cadastro (antes do fuzzy)

1. Por CPF/CNPJ (dígitos) ou nome normalizado
2. **Segunda passagem** (`consolidar_por_nome_identico`): mesmo `nome_norm` **somente** se duplicata de cadastro:
   - par `Validar` + `Validado`, ou
   - CPFs com typo (dígito faltando / um contido no outro)
3. **Nunca** fundir homônimos com CPFs distintos (ex.: dois `JOAO SILVA` diferentes)

Evita ambiguidade fuzzy (ex.: duas `Vitoria A Monteiro` Validar+Validado).

### 1º nome (obrigatório em todo match)

Primeiro token do PIX e do cadastro deve ser **idêntico** após `normalize_text` (maiúsculas, sem acento).

| Aceita | Rejeita |
|--------|---------|
| `JOÃO` ↔ `Joao` | `IASMIN` ↔ `VINICIUS` |
| `MARIA` ↔ `MARIA` | `M` ↔ `MARIA` (abreviação no **1º nome**) |
| `JOSÉ` ↔ `JOSE` | `JUAN` ↔ `JOÃO` |

Sem exceção: se 1º nome difere, candidato descartado antes do score.

### Abreviações no meio e sobrenome (cadastro ↔ PIX)

`token_casa_com_abreviacao`: token de 1 letra = inicial do token completo no outro lado (`M`↔`MARIA`, `B`↔`BARBOSA`, `S`↔`SILVA`).

`tokens_restantes_cadastro_casam`: cada token do cadastro (após 1º nome) casa com um token distinto do PIX. PIX pode ter tokens extras (nome completo da RF).

| Caminho | Quando aceita |
|---------|----------------|
| `token_set` ≥ 85% | 1º nome igual — **não** exige alinhamento token-a-token |
| `token_set_sem_prep` ≥ 85% | Idem, ignorando preposições DE/DA/DO |
| `partial_token_set+sobrenome` | 1º nome + sobrenome (com abrev.) + token_set 75–84 + partial ≥ 92% |
| `token_abrev_cadastro` | 1º nome + alinhamento abrev. + sobrenome + token_set **70–84%** |

Abaixo de 70% ou sem alinhamento de tokens → pendência.

---

### Scorers (`thefuzz`)

| Método | Quando aceita |
|--------|----------------|
| `token_set` | 1º nome igual + score ≥ 85% |
| `token_set_sem_prep` | 1º nome igual + sem preposições DE/DA/DO…, score ≥ 85% |
| `partial_token_set+sobrenome` | 1º nome igual + sobrenome igual + token_set 75–84 + partial ≥ 92% |
| `token_abrev_cadastro` | 1º nome igual + tokens restantes com abreviação + sobrenome + token_set ≥ 70% |

### Desempate / segurança

- Ambiguidade: gap ≥ 5 pts no **token_set** entre 1º e 2º aceito
- Dedup por `nome_norm` só em duplicata de cadastro — **não** homônimos
- Coluna `Metodo_fuzzy` no Excel de sucesso

### O que não resolve automaticamente

- Doador **ausente** no cadastro (maioria das pendências CPF em abril)
- Nome colado no cadastro (`VANESSAANUNCIACAO`) sem overlap de tokens
- Abreviação só no **PIX** (`JUAN B B SANTOS`) sem pessoa correspondente no cadastro
- Match só por sobrenome compartilhado (`… RIBEIRO` vs `… RIBEIRO`) — bloqueado pelo 1º nome

---

## Lições e armadilhas — Bahia 2025

Registro de problemas reais encontrados na sessão de validação (janeiro + abril).

### NotebookLM e fontes

| Armadilha | O que aconteceu | Fix / regra |
|-----------|-----------------|-------------|
| Reusar cache NLM | JSON antigo mascarava reextração | `limpar_cache_nlm()` em todo `processar_mes` |
| Planilhado &gt; NLM PIX | Datas erradas no XLSX (01/01 vs 02/01) | **NLM PDF PIX prioritário**; planilhado só se NLM vazio |
| Coluna `Remetente/Destinatario` | `nome_pix` não detectado | Alias em `COLUMN_ALIASES` |
| Abril 2 PDFs PIX | 2× `PIX sem par` | Conferir `por_pdf` no `resumo.json`; reextrair se faltar linha |

### Histórico extrato total

| Histórico | Tratamento |
|-----------|------------|
| `CRED PIX` | Doação — processar |
| `CRED PIX CHAVE` | Doação — processar (`HISTORICOS_CRED_PIX`) |
| `PIX RECEBIDO DADOS CONTA` | Doação — processar |
| `TAR PIX` | Tarifa — **Não PIX** (vem pareada à doação) |
| `DEB PIX CHAVE` | Débito/tarifa PIX — **Não PIX** |
| `CRED TEV` / `MANUT CTA` | Não doação — **Não PIX** |

### Mês civil e datas (Bahia 2025)

| Regra | Detalhe |
|-------|---------|
| **Mês da prestação** | `Data` do **extrato total** = dia que o crédito caiu na conta |
| **Não usar** | Pasta do PDF nem data do extrato PIX para classificar o mês |
| **Filtro** | `filtrar_extrato_mes_civil` antes da etapa 2; PIX **inteiro** para DDHHMM+valor |
| **Vazamento** | PDF pode trazer linhas do mês seguinte/anterior (ex. nov: 14× `01/12`) |
| **Sem artefato** | Se linha excluída consta 100% no PDF do mês efetivo, não gerar `Vazamento.xlsx` |
| **resumo.json** | `linhas_pdf` (bruto NLM), `linhas_mes` (consolidadas), `linhas_vazamento` |
| **Fim de semana** | Total `03/11` + PIX `01/11` é normal; pareamento por documento, não por igualdade de data |

Exemplo novembro 2025: PDF 153 linhas → **139** em nov/2025 após filtro; **14** com `01/12` processadas em dezembro.

### Contagem consolidadas (relatório)

- **Consolidadas** = `linhas_mes` (extrato total no mês civil)
- **Não somar** linhas do PDF PIX nem duplicatas descartadas do cadastro
- **CRED PIX** + tarifas/outros não-PIX + sucesso/pendências derivam só do total filtrado

### Fuzzy matching — erros evitados

| Caso | Risco | Regra aplicada |
|------|-------|----------------|
| `IASMIN … RIBEIRO` vs `VINICIUS … RIBEIRO` | CPF de outra pessoa (partial 100%) | **1º nome obrigatório** em todos os caminhos |
| Dois `Vitoria A Monteiro` (Validar + Validado) | Ambiguidade fuzzy gap 0 | `consolidar_por_nome_identico` |
| Dois `JOAO SILVA` CPFs diferentes | Fundir homônimos | Consolidar **só** duplicata cadastro |
| `token_set` ≥ 85 sem alinhamento token | Bloquear match bom | ≥85% **não** exige `tokens_restantes_cadastro_casam` |
| `token_set` 70–84 com cadastro `MATEUS B N SOUTO` | Perder match legítimo | `token_abrev_cadastro` + alinhamento |

### Pendências típicas (abril 2025)

19 CPF Ausente = doadores **não cadastrados** ou grafia RF muito diferente. Padrões frequentes:

- Nome completo RF: `BARBARA MARIA SANTOS SILVA`
- Abreviado RF: `JUAN B B SANTOS`, `JULIANA FREITAS M SILVA`
- Repetição: `WILLIAN JESUS DOS SANTOS` (2 transações)

Ação: incluir no `pessoas bahia.xlsx` ou rodar `exportar_fora_cadastro.py` para listar ao diretório.

### Benchmarks Bahia 2025 (pós-correções)

| Mês | CRED PIX | Sucesso | Taxa | CPF pend | Não PIX |
|-----|----------|---------|------|----------|---------|
| Janeiro | 34 | 31 | 91% | 3 | 2 |
| Abril | 66 | 45 | 68% | 19 | 8 |

---

## Etapa 5 — Exportação

### Consolidado_SPCA_Sucesso.xlsx

Uma aba `Sucesso`. Apenas linhas com match fuzzy bem-sucedido.

### Pendencias_e_Inconsistencias.xlsx

Uma aba `Pendencias`. Todas as linhas problemáticas empilhadas.

Colunas obrigatórias de controle:

- `categoria` — tipo do problema
- `motivo` — detalhe legível

Categorias:

| categoria | Origem |
|-----------|--------|
| Não PIX | Etapa 2 |
| PIX sem par | Etapa 3 |
| CPF ausente / fuzzy baixo | Etapa 4 (`CPF Ausente - Revisão Manual`) |
| Duplicata descartada | Etapa 1 |

---

## Constantes configuráveis

No topo de `scripts/conciliar_doacoes.py`:

```python
FUZZY_THRESHOLD = 85          # score mínimo
FUZZY_GAP = 5                 # diferença mínima vs 2º colocado
PAIR_TOLERANCE_MINUTES = 3    # tolerância pareamento PIX
HISTORICO_ALVO = "CRED PIX"   # rótulo padrão na saída
HISTORICOS_CRED_PIX           # frozenset com variantes aceitas
```

Aliases de colunas em `COLUMN_ALIASES`.

---

## Processamento mensal

### Configurar prestação

```bash
python scripts/prestacao.py --estado Bahia --ano 2025 --raiz "/caminho/SPCA UP V2"
python scripts/prestacao.py --mostrar --raiz "/caminho/SPCA UP V2"
```

Gera `resultados/prestacao.json`:

```json
{
  "estado": "Bahia",
  "estado_uf": "BA",
  "ano": 2025,
  "raiz": "/caminho/SPCA UP V2",
  "base_prestacao": "Bahia/Prestacao de contas - Bahia"
}
```

### Processar um mês

```bash
python scripts/processar_mes.py janeiro --estado Bahia --ano 2025 --raiz "/caminho/SPCA UP V2"
python scripts/processar_mes.py janeiro --raiz "/caminho/SPCA UP V2"   # usa prestacao.json
```

### Processar todos os meses

```bash
python scripts/processar_todos.py --estado Bahia --ano 2025 --raiz "/caminho/SPCA UP V2"
python scripts/processar_todos.py --meses janeiro fevereiro --forcar
```

### Resolução automática de arquivos

| Fonte | Pasta | Padrão de arquivo |
|-------|-------|-------------------|
| Extrato total | `{base}/Extrato total/{Mês}/` | `*total*`, `extrato*total*` |
| Extrato PIX | `{base}/Extrato total PIX/{Mês}/` | `*pix*` |
| Pessoas | `{Estado}/cadastro/` ou `{base}/pessoas.xlsx` ou `pessoas.pdf` | xlsx/csv ou NLM |

Se a pasta mensal só tiver **PDF**, `processar_mes.py` chama **NotebookLM** automaticamente.

### Saídas mensais

| Arquivo | Caminho |
|---------|---------|
| Sucesso | `{Estado}/{ano}/{mes}/Consolidado_SPCA_Sucesso.xlsx` |
| Pendências | `{Estado}/{ano}/{mes}/Pendencias_e_Inconsistencias.xlsx` |
| Resumo | `{Estado}/{ano}/{mes}/resumo.json` |
| NLM raw | `{Estado}/{ano}/{mes}/.cache/nlm_transacoes.json` |
| Fontes | `{Estado}/{ano}/{mes}/.cache/fontes.json` |
| Meta NLM | `{Estado}/{ano}/{mes}/.cache/nlm_meta.json` |
| Status global | `{Estado}/{ano}/status.json` |

---

## NotebookLM — extração JSON

### CLI

- Binário: `NLM_PATH` (padrão `~/.local/bin/nlm`)
- Timeout por query: `NLM_QUERY_TIMEOUT` (padrão 300s)
- Diagnóstico: `nlm doctor`

### Notebooks

1 notebook por **estado + ano + mês**: `SPCA-V2-{UF}-{ano}-{Mês}` (ex.: `SPCA-V2-BA-2025-Janeiro`, `SPCA-V2-SC-2025-Janeiro`).

### Regras

- **Sempre fresco**: `limpar_cache_nlm()` apaga JSON anterior antes de cada run
- **1 query por PDF** (extrato total e extrato PIX separados)
- `--pular-nlm` existe só para debug — **não** documentar como fluxo normal
- Prompt exige `origem_arquivo` = nome exato do PDF
- `cadastro_pessoas.csv` sobe como contexto; se só houver `pessoas.pdf`, NLM extrai cadastro em query separada

### `nlm_transacoes.json`

```json
{
  "transacoes": [
    {
      "data": "2025-01-02",
      "valor": 100.0,
      "tipo": "CRED PIX",
      "direcao": "entrada",
      "remetente_destinatario": "NOME",
      "numero_documento": "010757",
      "origem_arquivo": "EXTRATO TOTAL JANEIRO.pdf"
    }
  ]
}
```

### `fontes.json` (entrada da conciliação)

```json
{
  "versao": 1,
  "extrato_total": [
    {"Data": "02/01/2025", "Valor": "100,00", "Documento": "010757", "Histórico": "CRED PIX"}
  ],
  "extrato_pix": [
    {"Data": "02/01/2025", "Hora": "07:57:39", "Valor": "100,00", "Remetente/Destinatario": "NOME"}
  ],
  "pessoas": [
    {"nome": "Fulano", "documento": "123.456.789-00", "tipo": "Pessoa Física", "status": "Validado"}
  ],
  "meta": {"notebook": "SPCA-V2-BA-2025-Janeiro", "fonte_pix": "nlm", "fonte_pessoas": "cadastro_xlsx"}
}
```

### Prioridade PIX

1. Transações NLM dos PDFs em `Extrato total PIX/{Mês}/`
2. `Planilhado/{Mês}/*.xlsx` — somente se NLM PIX vazio

### Scripts

| Script | Função |
|--------|--------|
| `nlm_extrair_mes.py` | Só NLM → JSON |
| `processar_mes.py` | NLM (se preciso) + conciliação |
| `processar_todos.py` | Lote de meses |
| `exportar_fora_cadastro.py` | `pessoas_fora_cadastro.xlsx` anual |
| `lib_fora_cadastro.py` | Classificação não consta vs. precisa revisar |
| `lib_nlm.py` | Cliente `nlm`, prompts, normalização |
| `lib_json_fontes.py` | NLM/planilhado → `fontes.json` → DataFrame |

---

## Exemplo de execução

```bash
cd "/Users/marcosalexandre/Desktop/SPCA UP V2"

python3 -m venv .venv
.venv/bin/pip install -r ~/.cursor/skills/prestacao-spca/requirements.txt

.venv/bin/python ~/.cursor/skills/prestacao-spca/scripts/conciliar_doacoes.py \
  --total  "Bahia/Extrato total/Junho/extrato_total.csv" \
  --pix    "Bahia/Extrato total PIX/Junho/extrato_pix.csv" \
  --pessoas "Bahia/cadastro/pessoas bahia.xlsx" \
  --output "./output/junho"
```

---

## Troubleshooting

| Problema | Causa provável | Ação |
|----------|----------------|------|
| `Colunas não detectadas` | Cabeçalho fora dos aliases (`Remetente/Destinatario`) | Adicionar alias em `COLUMN_ALIASES` |
| Muitos `PIX sem par` | Planilhado com data errada ou NLM incompleto | Usar NLM PIX; conferir DDHHMM manualmente |
| Muitos `Não PIX` em abril | `TAR PIX` + `CRED PIX CHAVE` antes do fix | Históricos em `HISTORICOS_CRED_PIX` |
| CPF errado de outra pessoa | Match por sobrenome sem 1º nome | Verificar `primeiro_nome_igual` |
| Muitos CPF pendente | Cadastro incompleto | `exportar_fora_cadastro.py`; cadastrar doadores |
| Sucesso caiu após mudança fuzzy | Exigir abrev. em path ≥85% | ≥85% não exige alinhamento token-a-token |
| Valores não batem | Formato numérico | Verificar vírgula/ponto no CSV |
| Duplicatas no cadastro | Validar + Validado | Normal; `consolidar_por_nome_identico` |

---

## Exportação anual — pessoas fora do cadastro

Script: `scripts/exportar_fora_cadastro.py` · lógica: `scripts/lib_fora_cadastro.py`

Agrega nomes únicos das pendências mensais com categoria `CPF Ausente - Revisão Manual`, cruza com o cadastro estadual e classifica em **duas listas** (padrão validado Bahia 2025).

### Arquivo principal

`{Estado}/{ano}/pessoas_fora_cadastro.xlsx`

| Aba | Conteúdo |
|-----|----------|
| `resumo` | Totais |
| `todas` | Lista unificada com coluna **Situação** |
| `nao_consta_certeza` | Sem match exato — incluir no pedido ao diretório |
| `precisa_revisar` | Aproximação ou nome abreviado — conferir manualmente |

CSVs espelhados em `{Estado}/{ano}/fora_cadastro/`.

### Classificação

Para cada `nome_norm` agregado dos meses:

1. Calcular melhor candidato no cadastro (`token_set_ratio` / thefuzz).
2. Detectar nome abreviado: token de 1 letra (`JUAN B B SANTOS`), ou nome incompleto (2 tokens sem sobrenome usual).
3. **Precisa revisar** se:
   - melhor score ≥ **55%** (match parcial), **ou**
   - nome abreviado/incompleto.
4. **Não consta (certeza)** nos demais casos (score &lt; 55% e nome completo).

Constante: `LIMIAR_REVISAO_SCORE = 55` em `lib_fora_cadastro.py` (independente do `FUZZY_THRESHOLD = 85` da etapa 4).

### Colunas — precisa revisar

| Coluna | Descrição |
|--------|-----------|
| `nome` | Como aparece no extrato PIX |
| `motivo_revisao` | Parcial / abreviado / ambos |
| `nome_cadastro_candidato` | Melhor match no cadastro (se parcial) |
| `documento_candidato` | CPF/CNPJ do candidato |
| `similaridade` | Score fuzzy (%) |
| `meses` | Meses em que apareceu |
| `qtd_transacoes` | Linhas de pendência |

### Confirmação manual

| Decisão do usuário | Ação |
|--------------------|------|
| Candidato parcial **é** a mesma pessoa | Promover no cadastro/sucesso; remover das listas fora |
| Candidato parcial **não** é a mesma pessoa | Manter em **não consta**; observação de rejeição manual |

### TED / CRED TEV sem nome

Transações não-PIX no extrato total (ex.: `CRED TEV`) sem `remetente_destinatario` no NLM **não** entram nas listas de pessoas — reportar separadamente (data, valor, documento, PDF).

### Comando

```bash
python scripts/exportar_fora_cadastro.py --estado Bahia --ano 2025 --raiz "/caminho/SPCA UP V2"
```

Executar após todos os meses com `Pendencias_e_Inconsistencias.xlsx` gerados.

---

## BB unificado — cadastro a partir de `CPF_extrato`

Modelo `bb_unificado` (Patos, Santa Catarina): o PDF traz CPF/CNPJ na linha de detalhe. A etapa 4 tenta `match_pessoa_por_documento` **antes** do fuzzy.

### Sintoma

Mês N aprovado manualmente (`aprovado=S`), mês N+1 com as **mesmas pessoas** em `bloqueadas` com motivo `CPF Ausente - Revisão Manual (documento fora do cadastro)` e `CPF_extrato` preenchido.

**Causa:** mês N+1 processado quando o documento ainda não estava em `pessoas {estado}.xlsx`. O match por documento falha; não há herança entre meses.

**Exemplo validado (Patos 2025):** fevereiro 12 aprovadas via `cpf_extrato`; março 11 bloqueadas com os mesmos CPFs — março rodou antes de `atualizar_cadastro_bb`.

### Correção

```bash
atualizar_cadastro_bb.py --estado … --ano … --raiz .
processar_todos.py --forcar --pular-nlm --raiz .
gerar_revisao_anual.py --estado … --ano … --raiz .
```

`atualizar_cadastro_bb` lê `Pendencias_e_Inconsistencias.xlsx` de todos os meses, filtra linhas com `CPF_extrato` e motivo `fora do cadastro` / `CPF Ausente`, deduplica por documento e acrescenta ao cadastro (`status=Validado`, backup automático).

### Revisão anual

`gerar_revisao_anual.py` → `Revisao_Exportacao_SPCA_Anual[-{escopo}].xlsx` na pasta `{ano}/[escopo/]`, abas `prontas_exportar`, `bloqueadas`, `resumo_mensal`, `resumo`. Preserva `aprovado=S` das revisões mensais (merge por chave data+valor+documento+CPF).

---

## Regeneração do script

Se precisar reescrever o script do zero, manter:

1. Funções separadas por etapa (`limpar_pessoas`, `filtrar_extrato_total`, `parear_total_pix`, `cruzar_pessoas`, `exportar`)
2. Detecção fuzzy de cabeçalhos (`detect_column` / `map_columns`)
3. Regra de ouro: **nunca parear/adivinhar quando ambíguo**
4. Comentários em PT-BR explicando cada etapa
5. CLI argparse com `--total`, `--pix`, `--pessoas`, `--output`
