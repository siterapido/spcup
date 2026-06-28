"""Lógica de fechamento anual SPCA (importável).

CLI equivalente: ver ``fechar-anual.py`` no mesmo diretório.

Uso programático::

    from fechar_anual import swap_prestacao, restore_prestacao, UF_NOME
    swap_prestacao(Path("resultados/prestacao.json"), {"estado": "Bahia", ...})
    restore_prestacao(Path("resultados/prestacao.json"))
"""
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from load_constants import get_prestacao
from tse_io import PROJECT_RAIZ

# Mapeamento UF → nome do estado (em diretorios.xlsx / prestacao.json)
UF_NOME = {"BA": "Bahia", "SC": "Santa Catarina", "PB": "Paraíba"}


def swap_prestacao(p: Path, novo: dict) -> None:
    """Backup do prestacao.json atual e swap para novo dict.

    Contrato: SOBRESCREVE o JSON inteiro (não é merge). Backup preserva
    o conteúdo original, então ``restore_prestacao`` devolve o estado
    pré-swap sem perda de campos extras.
    """
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = p.with_name(f"{p.name}.bak-manual-{ts}")
    shutil.copy2(p, backup)
    p.write_text(json.dumps(novo, ensure_ascii=False, indent=2))


def restore_prestacao(p: Path) -> None:
    """Restaura prestacao.json do backup mais recente."""
    backups = sorted(p.parent.glob(f"{p.name}.bak-manual-*"))
    if not backups:
        print("⚠️  Nenhum backup encontrado, não restaurou", file=sys.stderr)
        return
    shutil.copy2(backups[-1], p)
    print(f"♻️  prestacao.json restaurado de {backups[-1].name}")


def run_step(label: str, cmd: list, cwd: Path = PROJECT_RAIZ) -> None:
    """Roda comando externo. Aborta com sys.exit se falhar."""
    print(f"\n=== {label} ===")
    print(f"$ {' '.join(str(c) for c in cmd)}")
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode != 0:
        print(f"❌ {label} falhou (exit {r.returncode})", file=sys.stderr)
        sys.exit(r.returncode)
    print(f"✅ {label} OK")


def build_prestacao_json(args, estado_nome: str) -> dict:
    """Monta dict de prestacao.json para o alvo.

    CNPJ e modelo_extrato vêm de load_constants (constants.yaml).
    base_prestacao segue convenção:
      - Estadual: <estado>
      - PB município: "Paraíba/municipios/<escopo>"
    """
    const = get_prestacao(estado_nome, args.escopo)
    if args.escopo:
        base_prestacao = f"{estado_nome}/municipios/{args.escopo}"
    else:
        base_prestacao = estado_nome
    return {
        "estado": estado_nome,
        "estado_uf": args.uf,
        "ano": args.ano,
        "raiz": str(PROJECT_RAIZ),
        "base_prestacao": base_prestacao,
        "modelo_extrato": const["modelo_extrato"],
        "atualizado_em": datetime.now().isoformat() + "Z",
        "escopo": args.escopo,
        "cnpj_prestador": const["cnpj_prestador"],
    }
