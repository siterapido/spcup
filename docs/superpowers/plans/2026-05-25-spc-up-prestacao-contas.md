# SPC UP Prestação de Contas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar piloto em 1 semana: ingestão Excel/OFX/CSV (+ PDF se couber), match com score, revisão web, exportação de 3 XMLs SPCA por UF/exercício com validação XSD e bloqueio de export enquanto houver pendências.

**Architecture:** Monólito Python (`spc_up`) com FastAPI + Typer compartilhando services; PostgreSQL on-prem; pipeline ingest → match → confirmação humana → export; OpenRouter para extração/classificação ambígua.

**Tech Stack:** Python 3.12, FastAPI, Typer, SQLAlchemy 2, Alembic, PostgreSQL 16, Pydantic v2, lxml, httpx, openpyxl, ofxparse, pytest.

**Spec:** `docs/superpowers/specs/2026-05-25-spc-up-prestacao-contas-design.md`

---

## File map (created by this plan)

| Path | Responsibility |
|------|----------------|
| `pyproject.toml` | deps, scripts `spc-up` |
| `docker-compose.yml` | Postgres 16 |
| `.env.example` | DATABASE_URL, OPENROUTER_API_KEY, limiares confiança |
| `spc_up/config.py` | Settings pydantic |
| `spc_up/models/*.py` | SQLAlchemy entities |
| `spc_up/schemas/*.py` | API/CLI DTOs |
| `spc_up/services/normalize.py` | CPF/CNPJ/nome |
| `spc_up/services/confidence.py` | score + evidências |
| `spc_up/services/ingest/ofx.py` | OFX/CSV extrato |
| `spc_up/services/ingest/excel.py` | planilhas |
| `spc_up/services/ingest/pdf.py` | OpenRouter PDF |
| `spc_up/services/match/rules.py` | match determinístico |
| `spc_up/services/export/origem.py` | XML origem |
| `spc_up/services/export/aplicacao.py` | XML aplicação |
| `spc_up/services/export/doacao.py` | XML doação |
| `spc_up/spca/validate.py` | lxml XSD |
| `spc_up/spca/enums.py` | fonte, espécie, direção |
| `spc_up/spca/schemas/*.xsd` | TSE (copiar) |
| `spc_up/spca/tabelas/*.yaml` | classificação receita, gastos |
| `spc_up/api/main.py` | FastAPI app |
| `spc_up/api/routes/*.py` | upload, movimentações, export |
| `spc_up/cli/main.py` | Typer entry |
| `tests/**` | unit + golden |

---

### Task 1: Bootstrap do projeto

**Files:**
- Create: `pyproject.toml`, `docker-compose.yml`, `.env.example`, `.gitignore`, `spc_up/__init__.py`, `spc_up/config.py`, `README.md`

- [ ] **Step 1: Criar `pyproject.toml`**

```toml
[project]
name = "spc-up"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "typer>=0.12",
  "sqlalchemy>=2.0",
  "alembic>=1.14",
  "psycopg[binary]>=3.2",
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "httpx>=0.27",
  "lxml>=5.3",
  "openpyxl>=3.1",
  "ofxparse>=0.21",
  "python-multipart>=0.0.12",
  "jinja2>=3.1",
]

[project.scripts]
spc-up = "spc_up.cli.main:app"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Criar `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: spcup
      POSTGRES_PASSWORD: spcup
      POSTGRES_DB: spcup
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 3: Criar `spc_up/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+psycopg://spcup:spcup@localhost:5432/spcup"
    openrouter_api_key: str = ""
    openrouter_model: str = "anthropic/claude-sonnet-4"
    confianca_limiar_alta: float = 0.85
    confianca_limiar_baixa: float = 0.60
    storage_root: str = "./data/uploads"

settings = Settings()
```

- [ ] **Step 4: Subir Postgres e instalar deps**

```bash
cd "/Volumes/SSDdoMarcos/Projetos/Prestação de contas"
docker compose up -d
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"  # adicionar dev opcional: pytest no pyproject optional-dependencies
pip install pytest
```

Expected: container `db` healthy.

- [ ] **Step 5: Commit**

```bash
git init
git add pyproject.toml docker-compose.yml .env.example spc_up/config.py .gitignore README.md
git commit -m "chore: bootstrap spc-up project"
```

---

### Task 2: Modelos SQLAlchemy + Alembic

**Files:**
- Create: `spc_up/models/base.py`, `spc_up/models/entities.py`, `alembic.ini`, `migrations/env.py`, `migrations/versions/001_initial.py`

- [ ] **Step 1: Teste falhando — import models**

```python
# tests/test_models.py
def test_movimentacao_status_enum():
    from spc_up.models.entities import MovimentacaoStatus
    assert MovimentacaoStatus.PENDENTE_REVISAO.value == "PENDENTE_REVISAO"
```

Run: `pytest tests/test_models.py -v` → FAIL (module missing)

- [ ] **Step 2: Implementar `spc_up/models/entities.py`** (enums + tabelas principais)

Incluir: `DiretorioEstadual`, `PessoaFisica`, `PessoaJuridica`, `ContaBancaria`, `ArquivoIngestao`, `Movimentacao`, `MovimentacaoSpca`, `MatchEvidencia`, `DoacaoFinanceiraLink` conforme spec seção 5.

`Movimentacao.hash_movimento` = String(64), unique com `(uf, exercicio, hash_movimento)`.

- [ ] **Step 3: Alembic init + migration 001**

```bash
alembic init migrations
alembic revision --autogenerate -m "initial"
alembic upgrade head
```

- [ ] **Step 4: pytest pass**

Run: `pytest tests/test_models.py -v` → PASS

- [ ] **Step 5: Commit** `feat: add database models and initial migration`

---

### Task 3: Normalização CPF/CNPJ e nomes

**Files:**
- Create: `spc_up/services/normalize.py`, `tests/test_normalize.py`

- [ ] **Step 1: Testes falhando**

```python
import pytest
from spc_up.services.normalize import normalize_cpf, normalize_cnpj, normalize_name

def test_normalize_cpf_strips_mask():
    assert normalize_cpf("123.456.789-09") == "12345678909"

def test_normalize_cnpj_alphanumeric():
    assert len(normalize_cnpj("12.345.678/0001-90")) == 14

def test_normalize_name():
    assert normalize_name("  João   da  Silva ") == "JOAO DA SILVA"
```

- [ ] **Step 2: Implementar** com validação dígito verificador CPF; CNPJ alfanumérico TSE `[A-Z0-9]{12}[0-9]{2}`.

- [ ] **Step 3: pytest pass**

- [ ] **Step 4: Commit** `feat: add cpf cnpj name normalization`

---

### Task 4: Serviço de confiança

**Files:**
- Create: `spc_up/services/confidence.py`, `tests/test_confidence.py`

- [ ] **Step 1: Teste — cap em conflito**

```python
from spc_up.services.confidence import compute_confidence, Evidence

def test_conflict_caps_score():
    ev = [
        Evidence("CPF_EXATO", 0.45),
        Evidence("CONFLITO_CPF", 0.0, cap=0.40),
    ]
    assert compute_confidence(ev) == 0.40
```

- [ ] **Step 2: Implementar** pesos da spec; retornar `(score, evidencias, bloqueio_export)` se campo obrigatório ausente.

- [ ] **Step 3: pytest pass**

- [ ] **Step 4: Commit** `feat: add confidence scoring service`

---

### Task 5: Copiar XSDs e validador

**Files:**
- Create: `spc_up/spca/validate.py`, `spc_up/spca/schemas/` (copiar arquivos)
- Copy: `Guia importação SPCA/origemRecurso (1).xsd` → `spc_up/spca/schemas/origemRecurso.xsd`
- Download TSE ZIPs → `aplicacaoRecurso.xsd`, `doacaoFinanceira.xsd`

- [ ] **Step 1: Teste validação origem mínima**

```python
from pathlib import Path
from spc_up.spca.validate import validate_xml

def test_validate_minimal_origem_xml(tmp_path):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
      <CABECALHO><nrCnpjPrestador>23738595000182</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
      <CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO>
    </spcaImportacaoArquivo>"""
    p = tmp_path / "t.xml"
    p.write_text(xml, encoding="utf-8")
    errors = validate_xml(p, schema_name="origem")
    assert errors == []
```

- [ ] **Step 2: Implementar `validate.py`** com `lxml.etree.XMLSchema`.

- [ ] **Step 3: pytest pass** (skip se XSD ausente com pytest.mark.skipif)

- [ ] **Step 4: Commit** `feat: add spca xsd validator`

---

### Task 6: Tabelas de domínio YAML

**Files:**
- Create: `spc_up/spca/tabelas/classificacao_receita.yaml`, `codigos_gasto.yaml`, `spc_up/spca/load_tables.py`

- [ ] **Step 1: Seed mínimo piloto** (10–15 códigos mais usados pela UP: 314, 333, 334, 336, 341, etc. + gastos 401–410 exemplo)

- [ ] **Step 2: Teste carregamento**

```python
from spc_up.spca.load_tables import get_classificacao_label

def test_load_classificacao():
    assert "314" in get_classificacao_label("314") or get_classificacao_label(314)
```

- [ ] **Step 3: Commit** `feat: add spca domain tables`

---

### Task 7: Ingestão OFX/CSV

**Files:**
- Create: `spc_up/services/ingest/ofx.py`, `tests/fixtures/sample.ofx`, `tests/test_ingest_ofx.py`

- [ ] **Step 1: Fixture OFX** com 1 crédito e 1 débito.

- [ ] **Step 2: Teste**

```python
def test_parse_ofx_directions():
    from spc_up.services.ingest.ofx import parse_ofx
    rows = parse_ofx("tests/fixtures/sample.ofx")
    assert any(r["direcao"] == "ENTRADA" for r in rows)
    assert any(r["direcao"] == "SAIDA" for r in rows)
```

- [ ] **Step 3: Implementar** + função `persist_transactions(session, uf, exercicio, arquivo_id, rows)` criando `Movimentacao` RASCUNHO com `hash_movimento`.

- [ ] **Step 4: pytest pass**

- [ ] **Step 5: Commit** `feat: add ofx csv ingestion`

---

### Task 8: Ingestão Excel

**Files:**
- Create: `spc_up/services/ingest/excel.py`, `tests/fixtures/sample.xlsx`, `tests/test_ingest_excel.py`

- [ ] **Step 1: Planilha fixture** colunas: `data`, `valor`, `descricao`, `tipo`(C/D) opcional.

- [ ] **Step 2: Teste parse + direção**

- [ ] **Step 3: Implementar** openpyxl; mapeamento configurável por aba (piloto: convenção fixa documentada no README).

- [ ] **Step 4: Commit** `feat: add excel ingestion`

---

### Task 9: Match determinístico

**Files:**
- Create: `spc_up/services/match/rules.py`, `tests/test_match_rules.py`

- [ ] **Step 1: Teste CPF no histórico**

```python
def test_match_cpf_in_description(db_session, sample_movimentacao):
    from spc_up.services.match.rules import apply_deterministic_match
    apply_deterministic_match(db_session, sample_movimentacao.id)
    m = reload(sample_movimentacao)
    assert m.confianca_global >= 0.45
```

- [ ] **Step 2: Implementar** extração CPF/CNPJ regex da `descricao_raw`, link `pessoa_*`, criar `MatchEvidencia`, chamar `confidence.compute`.

- [ ] **Step 3: Atualizar status** para `PENDENTE_REVISAO` se score < 0.85.

- [ ] **Step 4: Commit** `feat: add deterministic transaction matching`

---

### Task 10: Export XML Origem

**Files:**
- Create: `spc_up/services/export/origem.py`, `spc_up/services/export/common.py`, `tests/test_export_origem.py`

- [ ] **Step 1: Teste gera XML com 1 origem PF PIX**

- [ ] **Step 2: Builder lxml** namespace `http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd`; só movimentações `CONFIRMADO`, `direcao=ENTRADA`.

- [ ] **Step 3: Validar XSD no teste**

- [ ] **Step 4: Commit** `feat: add origem recurso xml export`

---

### Task 11: Export XML Aplicação

**Files:**
- Create: `spc_up/services/export/aplicacao.py`, `tests/test_export_aplicacao.py`

- [ ] **Step 1: Teste 1 gasto** pessoa jurídica + `gastoContaContabil` + detalhe situação 1.

- [ ] **Step 2: Implementar** root `importacaoAplicacaoRecurso`; default `detalhe_situacao=1`, `descricaoResumida` da movimentação.

- [ ] **Step 3: Validar contra `aplicacaoRecurso.xsd`**

- [ ] **Step 4: Commit** `feat: add aplicacao recurso xml export`

---

### Task 12: Doação financeira + vínculo

**Files:**
- Create: `spc_up/services/export/doacao.py`, `spc_up/services/doacao/link.py`, `tests/test_export_doacao.py`

- [ ] **Step 1: Quando `classificacao_receita` em DOACAO_CODES, criar `DoacaoFinanceiraLink`**

- [ ] **Step 2: Export só links `sincronizado=True` e origem confirmada**

- [ ] **Step 3: Teste par origem+doação**

- [ ] **Step 4: Commit** `feat: add doacao financeira export and linking`

---

### Task 13: Bloqueio de export + pendências

**Files:**
- Create: `spc_up/services/export/guard.py`, `spc_up/services/report/pendencias.py`, `tests/test_export_guard.py`

- [ ] **Step 1: Teste bloqueio**

```python
def test_export_blocked_when_pending(db_session):
    from spc_up.services.export.guard import can_export
    assert can_export(db_session, uf="SP", exercicio=2025) is False
```

- [ ] **Step 2: `can_export`** verifica spec seção 6.

- [ ] **Step 3: CSV pendências** colunas da spec 7.3.

- [ ] **Step 4: Commit** `feat: add export guard and pendencias report`

---

### Task 14: Cliente OpenRouter (PDF)

**Files:**
- Create: `spc_up/services/ai/openrouter.py`, `spc_up/services/ingest/pdf.py`, `tests/test_openrouter_parse.py` (mock httpx)

- [ ] **Step 1: Mock test** retorno JSON `{cpf, nome, valor, data, direcao}`

- [ ] **Step 2: Implementar** prompt estruturado + `response_format` JSON; timeout/retries.

- [ ] **Step 3: `ingest/pdf.py`** chama AI, persiste movimentação, reusa match.

- [ ] **Step 4: Commit** `feat: add openrouter pdf extraction`

---

### Task 15: CLI Typer

**Files:**
- Create: `spc_up/cli/main.py`

- [ ] **Step 1: Comandos**

```python
# spc_up/cli/main.py — wire:
# ingest, pendencias, confirm, export, validate-xsd
```

- [ ] **Step 2: Teste smoke** `spc-up --help` e `spc-up validate-xsd` com fixture.

- [ ] **Step 3: Commit** `feat: add typer cli`

---

### Task 16: API FastAPI (piloto web)

**Files:**
- Create: `spc_up/api/main.py`, `spc_up/api/deps.py`, `spc_up/api/routes/upload.py`, `movimentacoes.py`, `export.py`, `templates/*.html`

- [ ] **Step 1: POST `/api/upload`** multipart → `arquivo_ingestao` + job ingest

- [ ] **Step 2: GET `/api/movimentacoes`** filtros uf, exercicio, status, min_score

- [ ] **Step 3: POST `/api/movimentacoes/{id}/confirm`**

- [ ] **Step 4: GET `/api/export/{uf}/{exercicio}`** retorna 403 se `can_export` false; senão zip com 3 XMLs + validacao.json

- [ ] **Step 5: UI mínima Jinja** dashboard + tabela pendências (sem impeccable polish no piloto)

- [ ] **Step 6: Commit** `feat: add fastapi web for pilot`

---

### Task 17: Seed diretórios + README operação

**Files:**
- Create: `scripts/seed_diretorios.py`, update `README.md`

- [ ] **Step 1: Script insere 27 UFs com CNPJ placeholder** (substituir pelos reais antes do piloto)

- [ ] **Step 2: Documentar** fluxo: ingest → revisar → confirmar → export → upload manual SPCA

- [ ] **Step 3: Commit** `docs: add operations readme and seed script`

---

### Task 18: Checklist E2E piloto (manual)

**Files:**
- Create: `docs/piloto-checklist.md`

- [ ] **Step 1: Checklist**

1. Escolher 2 UFs com CNPJ real cadastrado  
2. `spc-up ingest` com OFX/Excel reais anonimizados  
3. Revisar 10 movimentações na web; confirmar  
4. `spc-up export` → 3 XMLs  
5. Importar no SPCA homologação  
6. Gerar `pendencias.csv` e enviar ao estado  

- [ ] **Step 2: Registrar resultados** no checklist (pass/fail)

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Multi-exercício 2024/2025 | Task 2, 7, 8 |
| 3 XML por CNPJ UF | Task 10–12 |
| Bloqueio export | Task 13 |
| Scores confiança | Task 4, 9 |
| OpenRouter | Task 14 |
| Web + CLI | Task 15–16 |
| On-prem Postgres | Task 1–2 |
| Pendências estados | Task 13 |
| Doação vínculo origem | Task 12 |
| XSD validation | Task 5, 10–12 |

## Pilot risk note

Se Dia 6 atrasar: ship Origem+Aplicação perfeitos; Doação com campos mínimos obrigatórios do XSD apenas.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-25-spc-up-prestacao-contas.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement task-by-task in this session with checkpoints  

Which approach do you want?
