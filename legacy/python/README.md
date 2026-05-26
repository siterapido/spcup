# Python monolith (archived reference)

This directory holds the original **Python 3.12** SPC UP stack (FastAPI, Typer, SQLAlchemy, Alembic, pytest). It is kept for **historical reference and parity checks** only.

**Canonical implementation:** TypeScript monorepo at the repo root (`apps/web`, `apps/cli`, `packages/*`). Use `pnpm install`, `pnpm test`, and `pnpm spc-up` per the root [README.md](../../README.md).

## Running locally (optional)

From this directory:

```bash
cd legacy/python
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# Postgres (optional): from repo root — docker compose up -d
alembic upgrade head
python scripts/seed_diretorios.py
pytest
```

FastAPI (archived): `uvicorn spc_up.api.main:app --reload --port 8000`

Or use `scripts/run-local.sh` (expects repo-root `docker-compose.yml` for Postgres).
