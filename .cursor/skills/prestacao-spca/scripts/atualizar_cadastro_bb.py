#!/usr/bin/env python3
"""
Inclui no cadastro TSE (bb_unificado) pessoas com CPF/CNPJ do extrato ainda fora do cadastro.

Lê Pendencias_e_Inconsistencias.xlsx de todos os meses processados, deduplica por documento
e acrescenta linhas em pessoas {estado}.xlsx: nome · documento · tipo · status=Validado.

Exemplo:
  atualizar_cadastro_bb.py --estado "Santa Catarina" --ano 2025 --raiz .
  atualizar_cadastro_bb.py --dry-run --estado SC --ano 2025 --raiz .
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_atualizar_cadastro_bb import atualizar_cadastro_bb  # noqa: E402
from lib_paths import carregar_prestacao  # noqa: E402
from processar_mes import resolver_contexto  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Atualiza cadastro TSE com CPF/CNPJ do extrato BB unificado",
    )
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument("--meses", nargs="*", help="Slugs (padrão: todos com pendências)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Só mostra quantas linhas seriam adicionadas, sem gravar",
    )
    args = parser.parse_args()

    raiz, uf, ano = resolver_contexto(args)
    prestacao = carregar_prestacao(raiz)
    if not prestacao:
        print(json.dumps({"erro": "prestacao.json não encontrado"}, ensure_ascii=False), file=sys.stderr)
        return 2

    try:
        saida = atualizar_cadastro_bb(
            raiz,
            prestacao,
            meses=args.meses,
            dry_run=args.dry_run,
        )
    except ValueError as exc:
        print(json.dumps({"erro": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps(saida, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
