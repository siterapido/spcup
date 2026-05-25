# SPC UP — Prestação de Contas

Piloto de ingestão, match e exportação SPCA para prestação de contas partidárias.

## Quick start

1. **Subir PostgreSQL**

   ```bash
   docker compose up -d
   ```

2. **Configurar ambiente**

   ```bash
   cp .env.example .env
   # Edite .env conforme necessário
   ```

3. **Instalar dependências**

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -e ".[dev]"
   ```

4. **Verificar**

   ```bash
   python -c "from spc_up.config import settings; print(settings.database_url)"
   ```

## Stack

Python 3.12, FastAPI, Typer, SQLAlchemy 2, Alembic, PostgreSQL 16, Pydantic v2.

## SPCA XSD schemas

Schemas live in `spc_up/spca/schemas/`:

- `origemRecurso.xsd` — bundled from the SPCA import guide
- `aplicacaoRecurso.xsd` — **placeholder**: download from TSE and add to `spc_up/spca/schemas/`
- `doacaoFinanceira.xsd` — **placeholder**: download from TSE and add to `spc_up/spca/schemas/`

Tests for schemas that are not yet present are skipped via `pytest.mark.skipif`.
