#!/usr/bin/env python3
"""Gera pessoas_fora_cadastro.xlsx a partir das pendências mensais SPCA."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_fora_cadastro import gerar_listas_fora_cadastro  # noqa: E402
from lib_paths import carregar_prestacao  # noqa: E402
from processar_mes import resolver_contexto  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Exporta pessoas_fora_cadastro.xlsx (sem match exato + aproximação).",
    )
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    args = parser.parse_args()

    raiz, uf, ano = resolver_contexto(args)
    prestacao = carregar_prestacao(raiz)
    if not prestacao:
        print(json.dumps({"erro": "prestacao.json não encontrado"}, ensure_ascii=False), file=sys.stderr)
        return 2

    saida = gerar_listas_fora_cadastro(raiz, prestacao)
    print(json.dumps(saida, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
