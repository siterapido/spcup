# Instalador spcup (Windows PowerShell)
# Uso: irm https://raw.githubusercontent.com/ORG/spc-up/main/scripts/install-spcup.ps1 | iex
$ErrorActionPreference = "Stop"

$NeedNode = 20
$Package = if ($env:SPCUP_NPM_PACKAGE) { $env:SPCUP_NPM_PACKAGE } else { "@spc-up/cli" }
$Tag = if ($env:SPCUP_NPM_TAG) { $env:SPCUP_NPM_TAG } else { "latest" }

Write-Host "→ Instalador spcup (SPC UP)"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js $NeedNode+ é obrigatório. Instale em https://nodejs.org/"
}

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt $NeedNode) {
  Write-Error "Node $NeedNode+ é obrigatório (encontrado: $(node -v))."
}

if ($env:SPCUP_TARBALL_URL) {
  $tmp = Join-Path $env:TEMP "spcup.tgz"
  Write-Host "→ Baixando pacote..."
  Invoke-WebRequest -Uri $env:SPCUP_TARBALL_URL -OutFile $tmp -UseBasicParsing
  npm install -g $tmp
  Remove-Item $tmp -Force
} elseif ($env:SPCUP_LOCAL_TARBALL) {
  npm install -g $env:SPCUP_LOCAL_TARBALL
} else {
  Write-Host "→ Instalando ${Package}@${Tag}..."
  npm install -g "${Package}@${Tag}"
}

Write-Host ""
Write-Host "→ Configuração inicial..."
spcup install

Write-Host ""
Write-Host "✓ Instalação concluída"
spcup --version
