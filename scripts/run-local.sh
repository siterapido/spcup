#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if [[ "${LEGACY_PYTHON:-}" == "1" ]]; then
  echo "==> SPC UP — modo legado Python (LEGACY_PYTHON=1)"
  exec "$ROOT/legacy/python/scripts/run-local.sh"
fi

echo "==> SPC UP — ambiente local (Node / Next.js)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "ERRO: pnpm não encontrado. Instale com: corepack enable && corepack prepare pnpm@9.15.0 --activate"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Criado .env a partir de .env.example"
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

use_docker=false
if [[ "${USE_DOCKER_POSTGRES:-}" == "1" ]]; then
  use_docker=true
elif [[ -z "${DATABASE_URL:-}" ]]; then
  use_docker=true
  export DATABASE_URL="postgresql://spcup:spcup@localhost:5432/spcup"
  export DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-$DATABASE_URL}"
fi

if [[ "$use_docker" == true ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERRO: Docker não encontrado. Defina DATABASE_URL (Neon) ou instale Docker."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "==> Iniciando Docker Desktop..."
    open -a Docker 2>/dev/null || true
    for _ in {1..60}; do
      docker info >/dev/null 2>&1 && break
      sleep 2
    done
  fi
  echo "==> PostgreSQL (docker compose)"
  docker compose up -d
  sleep 2
fi

echo "==> pnpm install"
pnpm install

echo "==> Drizzle migrations"
pnpm db:migrate

echo "==> Seed diretórios (27 UFs)"
pnpm seed:diretorios

if [[ -n "${ADMIN_EMAIL:-}" && -n "${ADMIN_PASSWORD:-}" ]]; then
  echo "==> Seed admin"
  pnpm seed:admin
else
  echo "==> Seed admin ignorado (defina ADMIN_EMAIL e ADMIN_PASSWORD no .env)"
fi

echo "==> Testes"
pnpm test

echo ""
echo "==> Iniciando Next.js (pnpm dev)"
echo "    App: http://localhost:3002"
echo "    Login: ADMIN_EMAIL do .env"
echo "    Ctrl+C para parar"
echo ""

exec pnpm dev
