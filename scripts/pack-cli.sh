# Empacota @spc-up/cli para distribuição (.tgz) — hospede em GitHub Release ou envie aos usuários.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "→ Compilando CLI..."
pnpm --filter @spc-up/cli build

OUT_DIR="${ROOT}/dist/releases"
mkdir -p "$OUT_DIR"

cd apps/cli
TARBALL="$(npm pack --pack-destination "$OUT_DIR" 2>&1 | tail -1 | tr -d "'")"

echo ""
echo "✓ Pacote gerado:"
echo "  ${OUT_DIR}/${TARBALL}"
echo ""
echo "Distribuir aos usuários:"
echo "  SPCUP_LOCAL_TARBALL=${OUT_DIR}/${TARBALL} bash scripts/install-spcup.sh"
echo ""
echo "Ou publique ${TARBALL} em GitHub Release e use:"
echo "  SPCUP_TARBALL_URL=https://github.com/ORG/spc-up/releases/download/vX/Y.tgz bash scripts/install-spcup.sh"
