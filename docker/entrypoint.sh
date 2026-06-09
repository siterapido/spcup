#!/bin/sh
set -e

cd /app

if [ -f /app/.env.runtime ]; then
  set -a
  # shellcheck disable=SC1091
  . /app/.env.runtime
  set +a
fi

echo "==> Iniciando Next.js"
if [ -f apps/web/server.js ]; then
  SERVER=apps/web/server.js
elif [ -f server.js ]; then
  SERVER=server.js
else
  echo "ERRO: server.js não encontrado"
  ls -la
  exit 1
fi
exec runuser -u nextjs -- node "$SERVER"
