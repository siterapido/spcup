# SPC UP — Sistema de Prestação de Contas (Design)

**Data:** 2026-05-25  
**Cliente:** Unidade Popular (UP) — SPC UP  
**Status:** Aprovado em brainstorming (seções 1–3)

---

## 1. Resumo executivo

Sistema Python on-prem para consolidar dados financeiros partidários espalhados em planilhas e PDFs, identificar responsáveis por transação (PF/PJ), apontar lacunas para cobrança aos estados, e gerar arquivos XML de importação do **SPCA** (Origem de Recursos, Aplicação de Recursos, Doação Financeira) — um conjunto de três XMLs **por diretório estadual (CNPJ)** e exercício.

**MVP acordado (entrega B):** consolidação + exportação XML validada por XSD; upload manual no SPCA por pessoa autorizada. Automação de envio ao TSE fica fora do MVP.

**Piloto:** 1 semana, 2–3 UFs (definidas na implantação), web + CLI, equipe nacional apenas.

---

## 2. Decisões de produto (registro)

| Tema | Decisão |
|------|---------|
| MVP | B — XML SPCA + upload manual |
| Exercícios | 2024 e 2025 (multi-exercício desde o início) |
| UFs | Estrutura para 27; ingestão gradual |
| Fontes | Excel, PDF extrato, OFX/CSV, PDF comprovante (~centenas/mês/UF) |
| Operação | A — só equipe nacional |
| Validação | 1 — bloquear export com pendências; scores de confiança por match |
| Infra | A — servidor próprio, PostgreSQL local |
| IA | C — OpenRouter com dados completos (DPA) |
| Interface | C — Web + CLI |
| Documentação TSE | XSD origem + guia aplicação + doação no MVP |
| Export SPCA | A — um par/trio de XML por CNPJ estadual |
| Doações | A — terceiro exportador no MVP |
| Prazo piloto | D — 1 semana, 2–3 UFs |

---

## 3. Contexto regulatório (SPCA)

- Prestação de contas anual de partidos via **SPCA Cadastro** ([TSE](https://www.tse.jus.br/partidos/contas-partidarias/entrega-da-prestacao-de-contas/sistema-de-prestacao-de-contas-anuais-spca)).
- Resolução TSE nº 23.604/2019; Plano de Contas (Portaria TSE nº 987/2022).
- Importação oficial: [Origem, Aplicação e Doação financeira](https://www.tse.jus.br/partidos/contas-partidarias/entrega-da-prestacao-de-contas/importacao-de-origem-e-aplicacao-de-recursos) (XML + XSD).

### Separação entradas / saídas

| Direção interna | Módulo SPCA | Schema | Significado |
|-----------------|-------------|--------|-------------|
| ENTRADA (crédito) | Origem de Recursos | `origemRecurso.xsd` | De onde veio o recurso |
| SAIDA (débito) | Aplicação de Recursos | `aplicacaoRecurso.xsd` | Despesa / quem recebeu |
| Doação PF (vínculo) | Doação financeira | `doacaoFinanceira.xsd` | Complemento a doações (recibo, etc.) |

**Regra:** crédito no extrato → Origem (+ Doação quando classificação de doação PF). Débito → Aplicação. Nunca misturar em um único XML.

### Cabeçalho comum (3 XMLs)

- `nrCnpjPrestador` — CNPJ do diretório estadual
- `anoExercicio` — 2024 ou 2025

### Origem de Recursos (entradas) — campos críticos

Por item `origem`: `dtEntrada`, `vrOrigem`, `fonteRecurso` (FP|OR|RC|FEFC), `naturezaRecurso` (0|1), `origemRecurso` (PF|PJ|PP|CF|CE|CA|NI), `classificacaoReceita` (300–397), `especieRecurso` (PIX, TED, CH, …), conta destino.

**Restrição 2026+:** contas 321, 323–327, 398 não válidas para exercício ≥ 2026 (validar no exportador).

### Aplicação de Recursos (saídas)

Por item `gasto`: `pessoa` (PF/PJ favorecido), `dadosDocumento`, `gastoContaContabil` (`cdDescricaoGasto`, `vrGasto`), detalhe situação 1–11 (piloto: situação 1 + `descricaoResumida` como default).

### Doação financeira

Quando entrada é doação PF (`classificacao_receita` 314, 315, 397, etc.): registrar em Origem **e** vincular export Doação com `nr_recibo_doacao`, mesmo CPF/valor/data. Export doação só com vínculo `sincronizado=true`.

### Artefatos versionados no repositório

```
spc_up/spca/schemas/
  origemRecurso.xsd
  aplicacaoRecurso.xsd      # baixar do TSE
  doacaoFinanceira.xsd      # baixar do TSE
spc_up/spca/tabelas/
  classificacao_receita.yaml
  codigos_gasto.yaml        # subset piloto extraído do guia
```

Referência local: `Guia importação SPCA/SPCA_Cadastro_Importacao_Aplicacao_Recursos_Guia_do_Usuario.pdf`, `origemRecurso (1).xsd`.

---

## 4. Arquitetura

### 4.1 Visão

- **Monólito Python** (recomendado): FastAPI + Typer + PostgreSQL + fila local de jobs.
- Servidor **on-prem UP**; arquivos brutos em volume criptografado.
- **OpenRouter** para PDF, planilhas irregulares e classificação ambígua.
- Validador **XSD obrigatório** antes de liberar download.

### 4.2 Componentes

| Componente | Responsabilidade |
|------------|------------------|
| `ingest` | Excel, OFX/CSV, PDF → `movimentacao` rascunho |
| `match` | Regras determinísticas + score + evidências |
| `ai` | Cliente OpenRouter estruturado (JSON schema) |
| `export` | Builders XML × 3 + validação |
| `api` / `cli` | Mesmos services |

### 4.3 Piloto 1 semana — escopo

**Incluir:** 2–3 UFs; Excel + OFX/CSV; web upload/revisão/export; CLI ingest/export/pendencias; 3 XMLs; bloqueio export.

**Adiar:** 27 UFs; automação upload TSE; todas situações 1–11 de detalhe gasto; PDF complexo se atrasar (Plano B: Origem+Aplicação perfeitos, Doação mínima).

**Critério de sucesso:** ≥ 80% movimentações estruturadas com score ≥ 0,85 pós-revisão; 3 XMLs passam validação XSD; importação manual OK no SPCA homologação.

---

## 5. Modelo de dados

### 5.1 Entidades

- `diretorio_estadual` — `uf`, `cnpj_prestador`, `nome`, `ativo`
- `conta_bancaria` — vínculo ao diretório, agência, conta, DV
- `pessoa_fisica` — `cpf` único, `nome`, `titulo_eleitor` opcional, `aliases`
- `pessoa_juridica` — `cnpj` único, `razao_social`, `aliases`
- `arquivo_ingestao` — rastreio upload, hash, status job
- `movimentacao` — núcleo transacional
- `movimentacao_spca` — campos de destino SPCA (1:1)
- `match_evidencia` — auditoria de score
- `doacao_financeira_link` — par origem ↔ doação
- `audit_log` — ações humanas e export

### 5.2 `movimentacao`

| Campo | Tipo | Notas |
|-------|------|-------|
| `exercicio` | int | 2024, 2025 |
| `uf` | FK | |
| `direcao` | enum | ENTRADA, SAIDA |
| `valor` | decimal | |
| `data_movimento` | date | |
| `descricao_raw` | text | |
| `nr_extrato_bancario` | string? | |
| `conta_bancaria_id` | FK? | |
| `pessoa_fisica_id` / `pessoa_juridica_id` | FK? | responsável |
| `status` | enum | RASCUNHO → PENDENTE_REVISAO → CONFIRMADO → EXPORTADO / REJEITADO |
| `confianca_global` | float | 0–1 |
| `bloqueio_export` | bool | |
| `hash_movimento` | string | deduplicação |

### 5.3 Estados

```
RASCUNHO → PENDENTE_REVISAO → CONFIRMADO → EXPORTADO
                ↓
            REJEITADO
```

### 5.4 `movimentacao_spca`

Flags `modulos`: ORIGEM, APLICACAO, DOACAO.

Campos: `fonte_recurso`, `natureza_recurso`, `tipo_origem_recurso`, `classificacao_receita`, `especie_recurso`, `cd_descricao_gasto`, `tipo_documento`, `nr_documento`, `data_emissao_contratacao`, `detalhe_situacao`, `descricao_resumida`, `nr_recibo_doacao`.

---

## 6. Matriz de confiança

| Evidência | Peso |
|-----------|------|
| CPF/CNPJ válido e igual cadastro | +0.45 |
| Valor (±R$0,01) e data iguais | +0.25 |
| Nome normalizado ≥ 95% | +0.20 |
| Nome fuzzy 80–94% | +0.10 |
| IA alinhada a regra parcial | +0.15 |
| Conflito 2+ CPFs mesmo valor/data | cap 0.40 |
| Campo XSD obrigatório vazio | bloqueio_export |

| Faixa | Ação |
|-------|------|
| ≥ 0.85 | Pode confirmar em lote |
| 0.60 – 0.84 | Revisão linha a linha |
| < 0.60 | Pendência + relatório estado |

**Export bloqueado** para `(uf, exercicio)` se existir movimentação com `status` ∉ {CONFIRMADO, EXPORTADO} ou `bloqueio_export=true`.

Configuração via env: `CONFIANCA_LIMIAR_ALTA=0.85`, `CONFIANCA_LIMIAR_BAIXA=0.60`.

---

## 7. Mapeamento ingestão → SPCA

### 7.1 Direção automática

- Crédito / positivo → ENTRADA → Origem (+ Doação se aplicável)
- Débito / pagamento → SAIDA → Aplicação

### 7.2 Responsável pela transação

- **Entrada:** doador em `origemRecurso` (PF/PJ/PP/…)
- **Saída:** favorecido em `pessoa` do gasto
- Cadeia `doadoresOriginarios` em transferências entre níveis: fase 2 (pós-piloto simplificado)

### 7.3 Relatório pendências

CSV por UF/exercício: data, valor, descrição, motivo, campos XSD faltantes, arquivo origem.

---

## 8. Interface

### 8.1 Web (FastAPI + templates ou SPA leve)

- Dashboard por UF/exercício
- Upload com fila
- Lista movimentações + revisão split
- Pendências + exportação (desabilitada se bloqueado)

Auth piloto: credencial env ou rede fechada.

### 8.2 CLI (Typer)

```
spc-up ingest --uf SP --exercicio 2025 --path ./lote/
spc-up pendencias --uf SP --exercicio 2025 --output pendencias.csv
spc-up confirm --ids uuid1,uuid2
spc-up export --uf SP --exercicio 2025 --out ./export/
spc-up validate-xsd --file origem.xml --schema origem
```

---

## 9. Erros e observabilidade

| Situação | Comportamento |
|----------|----------------|
| Arquivo ilegível | Job ERRO, sem movimentações órfãs |
| OpenRouter falha | 3 retries; depois PENDENTE "IA indisponível" |
| XSD inválido | Não publica XML; relatório de campos |
| Duplicata hash | REJEITADO ou ignorar com log |

Logs JSON; CPF mascarado em INFO.

---

## 10. Segurança e LGPD

- PostgreSQL e volume de arquivos com criptografia em repouso.
- RBAC: perfil `nacional` no piloto.
- Audit log imutável (confirmar, exportar, hash XML).
- OpenRouter: dados completos; exigir DPA; documentar na política interna.
- Retenção e exclusão: definir política UP (fora do piloto técnico).

---

## 11. Estrutura do repositório

```
spc-up/
├── pyproject.toml
├── spc_up/
│   ├── api/
│   ├── cli/
│   ├── models/
│   ├── schemas/
│   ├── services/{ingest,match,ai,export}/
│   ├── spca/{schemas,tabelas}/
│   └── security/
├── tests/
├── migrations/
├── docker-compose.yml
└── docs/superpowers/specs/
```

**Stack:** Python 3.12+, PostgreSQL 16, FastAPI, SQLAlchemy 2, Alembic, lxml, httpx, openpyxl.

---

## 12. Testes

- Unit: normalização, score, hash dedup
- Golden: OFX + Excel anonimizados
- XSD: três exports
- E2E manual: SPCA homologação

---

## 13. Cronograma piloto (7 dias)

| Dia | Foco |
|-----|------|
| D1 | Projeto, DB, ingest OFX/CSV |
| D2 | Excel, cadastro PF/PJ, match regras |
| D3 | Export Origem + XSD |
| D4 | Export Aplicação |
| D5 | OpenRouter PDF + scores |
| D6 | Doação + vínculo + web |
| D7 | Bloqueio export, CLI, teste 2–3 UFs |

---

## 14. Fora de escopo (MVP)

- Upload automático / RPA no SPCA
- Todos os 27 estados operando
- SPCE (campanha eleitoral)
- Mascaramento de PII para IA (decisão C explícita)

---

## 15. Próximo passo

Após revisão deste documento: gerar **plano de implementação** (`writing-plans`).
