#!/usr/bin/env bash
# Instalador spcup para usuários finais (sem clone do repositório).
#
# Uso (recomendado — detecta último release automaticamente):
#   curl -fsSL https://raw.githubusercontent.com/siterapido/spcup/main/scripts/install-spcup.sh | bash
#
# Variáveis opcionais:
#   SPCUP_GITHUB_REPO   default siterapido/spcup
#   SPCUP_TARBALL_URL   URL direta do .tgz (GitHub Release)
#   SPCUP_LOCAL_TARBALL caminho local do .tgz
#   SPCUP_NPM_PACKAGE   default @spc-up/cli (fallback npm)
#
set -euo pipefail

NEED_NODE=20
SPCUP_GITHUB_REPO="${SPCUP_GITHUB_REPO:-siterapido/spcup}"
SPCUP_NPM_PACKAGE="${SPCUP_NPM_PACKAGE:-@spc-up/cli}"
SPCUP_NPM_TAG="${SPCUP_NPM_TAG:-latest}"
SPCUP_NPM_REGISTRY="${SPCUP_NPM_REGISTRY:-https://registry.npmjs.org}"
ASSET_NAME="spc-up-cli"

echo "→ Instalador spcup (SPC UP — prestação de contas)"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js $NEED_NODE+ é obrigatório." >&2
  echo "Instale em https://nodejs.org/ e execute este script novamente." >&2
  exit 1
fi

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$node_major" -lt "$NEED_NODE" ]; then
  echo "Node $NEED_NODE+ é obrigatório (encontrado: $(node -v))." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado (deveria vir com Node.js)." >&2
  exit 1
fi

install_from_tarball_url() {
  local url="$1"
  local tmp
  tmp="$(mktemp -t spcup.XXXXXX.tgz)"
  echo "→ Baixando pacote..."
  echo "   $url"
  if ! curl -fsSL "$url" -o "$tmp"; then
    rm -f "$tmp"
    echo "" >&2
    echo "Erro ao baixar o pacote (HTTP 404 ou URL inválida)." >&2
    echo "" >&2
    echo "O release ainda não foi publicado ou a URL está errada." >&2
    echo "Peça à equipe UP o arquivo .tgz ou instale localmente:" >&2
    echo "  SPCUP_LOCAL_TARBALL=/caminho/spc-up-cli-0.1.0.tgz bash install-spcup.sh" >&2
    echo "" >&2
    echo "Repositório configurado: https://github.com/${SPCUP_GITHUB_REPO}/releases" >&2
    exit 1
  fi
  echo "→ Instalando spcup globalmente..."
  npm install -g "$tmp"
  rm -f "$tmp"
}

resolve_latest_release_url() {
  local api="https://api.github.com/repos/${SPCUP_GITHUB_REPO}/releases/latest"
  echo "→ Buscando último release em github.com/${SPCUP_GITHUB_REPO}..." >&2
  local body
  if ! body="$(curl -fsSL "$api" 2>/dev/null)"; then
    return 1
  fi
  node -e "
    const r = JSON.parse(process.argv[1]);
    const assets = r.assets || [];
    const match = assets.find(a => a.name && a.name.includes('${ASSET_NAME}') && a.name.endsWith('.tgz'));
    if (!match) {
      process.stderr.write('Nenhum asset ${ASSET_NAME}-*.tgz no release ' + (r.tag_name || '') + '\n');
      process.exit(1);
    }
    process.stdout.write(match.browser_download_url);
  " "$body"
}

install_from_registry() {
  echo "→ Instalando ${SPCUP_NPM_PACKAGE}@${SPCUP_NPM_TAG} do npm..."
  if ! npm install -g "${SPCUP_NPM_PACKAGE}@${SPCUP_NPM_TAG}" --registry "$SPCUP_NPM_REGISTRY" 2>/dev/null; then
    echo "" >&2
    echo "Pacote npm não encontrado. Use um release GitHub ou arquivo local." >&2
    exit 1
  fi
}

if [ -n "${SPCUP_LOCAL_TARBALL:-}" ]; then
  echo "→ Instalando de arquivo local: $SPCUP_LOCAL_TARBALL"
  npm install -g "$SPCUP_LOCAL_TARBALL"
elif [ -n "${SPCUP_TARBALL_URL:-}" ]; then
  install_from_tarball_url "$SPCUP_TARBALL_URL"
else
  if url="$(resolve_latest_release_url)"; then
    install_from_tarball_url "$url"
  else
    echo "→ Nenhum release GitHub encontrado; tentando npm..." >&2
    install_from_registry
  fi
fi

echo ""
echo "→ Configuração inicial..."
spcup install

echo ""
echo "✓ Instalação concluída"
echo ""
spcup --version
echo ""
echo "Próximos passos:"
echo "  1. Edite ~/.spc-up/.env (DATABASE_URL e OPENROUTER_API_KEY da UP)"
echo "  2. Na web UP: crie sessão em /prestacao/nova"
echo "  3. spcup prestacao run --sessao <uuid> --path ./seus-arquivos/"
