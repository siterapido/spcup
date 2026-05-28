# Atalho legado — use: .\bin\spcup.cmd install
& (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\bin\spcup.cmd") @args
