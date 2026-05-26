# SPC UP — Prestação de Contas

Consolidação de lançamentos financeiros dos diretórios estaduais da UP e exportação XML para importação no **SPCA** (Origem, Aplicação, Doação financeira).

## Clone e instalação

```bash
git clone https://github.com/unidade-popular/spc-up.git
cd spc-up
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env        # ajuste variáveis conforme necessário
pytest                      # testes usam SQLite em memória (sem PostgreSQL)
```

## Quick start

1. **PostgreSQL**

   ```bash
   docker compose up -d
   alembic upgrade head
   python scripts/seed_diretorios.py
   ```

2. **Ambiente**

   ```bash
   cp .env.example .env
   # OPENROUTER_API_KEY para ingestão de PDF
   ```

3. **Instalar**

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[dev]"
   ```

## Fluxo operacional

```text
Estados enviam arquivos → Equipe nacional ingere → Revisa pendências → Confirma → Exporta 3 XMLs → Upload manual no SPCA
```

### CLI

```bash
spc-up ingest --uf SP --exercicio 2025 --path ./dados/
spc-up pendencias --uf SP --exercicio 2025 --output pendencias.csv
spc-up confirm --ids "uuid1,uuid2"
spc-up export --uf SP --exercicio 2025 --out ./export/
spc-up validate-xsd --file ./export/origem_*.xml --schema origem
```

### Web (piloto)

```bash
uvicorn spc_up.api.main:app --reload --host 0.0.0.0 --port 8000
```

- http://localhost:8000 — dashboard e upload  
- http://localhost:8000/movimentacoes — revisão e confirmação  
- GET `/api/export/{uf}/{exercicio}` — ZIP com 3 XMLs (403 se houver pendências)

## Regras de exportação

- Export **bloqueado** enquanto existir movimentação não confirmada ou `bloqueio_export=true` na UF/exercício.
- Cada UF usa seu **CNPJ** (`diretorio_estadual.cnpj_prestador`) nos XMLs.
- **Crédito** → Origem (+ Doação se classificação de doação PF). **Débito** → Aplicação.

## Documentação

- Design: `docs/superpowers/specs/2026-05-25-spc-up-prestacao-contas-design.md`
- Plano: `docs/superpowers/plans/2026-05-25-spc-up-prestacao-contas.md`
- Piloto: `docs/piloto-checklist.md`
- Guias TSE: `Guia importação SPCA/`

## Stack

Python 3.12, FastAPI, Typer, SQLAlchemy 2, Alembic, PostgreSQL 16, lxml, OpenRouter (PDF).

## SPCA XSD

Schemas em `spc_up/spca/schemas/`: `origemRecurso.xsd`, `aplicacaoRecurso.xsd`, `doacaoFinanceira.xsd`.
