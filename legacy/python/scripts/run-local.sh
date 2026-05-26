#!/usr/bin/env bash
set -euo pipefail

LEGACY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$LEGACY_ROOT/../.." && pwd)"
cd "$LEGACY_ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "==> SPC UP (legacy Python) — ambiente local"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker não encontrado. Abra o Docker Desktop e rode este script de novo."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "==> Iniciando Docker Desktop..."
  open -a Docker 2>/dev/null || true
  for i in {1..60}; do
    if docker info >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  if ! docker info >/dev/null 2>&1; then
    echo "ERRO: Docker não respondeu. Inicie o Docker Desktop manualmente."
    exit 1
  fi
fi

echo "==> PostgreSQL (docker compose at repo root)"
docker compose -f "$REPO_ROOT/docker-compose.yml" up -d
sleep 2

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
  echo "Criado $REPO_ROOT/.env a partir de .env.example"
fi

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck source=/dev/null
source .venv/bin/activate

pip install -q -e ".[dev]"

echo "==> Migrations"
alembic upgrade head

echo "==> Seed diretórios (27 UFs)"
python scripts/seed_diretorios.py

echo "==> Testes"
pytest tests/ -q --tb=no

echo ""
echo "==> Iniciando API em http://127.0.0.1:8000"
echo "    Dashboard: http://127.0.0.1:8000/"
echo "    Movimentações: http://127.0.0.1:8000/movimentacoes?uf=SP&exercicio=2025"
echo "    Ctrl+C para parar"
echo ""

exec uvicorn spc_up.api.main:app --host 127.0.0.1 --port 8000 --reload
