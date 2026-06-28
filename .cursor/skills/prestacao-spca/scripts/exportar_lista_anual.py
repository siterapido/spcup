#!/usr/bin/env python3
"""Gera lista-anual.xlsx: pendências, movimentações consolidadas e resumos anuais."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_lista_anual import gerar_lista_anual  # noqa: E402
from lib_paths import carregar_prestacao  # noqa: E402
from processar_mes import resolver_contexto  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Exporta lista-anual.xlsx (pendências, consolidadas, doações, resumos).",
    )
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument(
        "--sem-excel",
        action="store_true",
        help="Só lista_anual_resumo.json, sem gravar xlsx",
    )
    args = parser.parse_args()

    raiz, _uf, _ano = resolver_contexto(args)
    prestacao = carregar_prestacao(raiz)
    if not prestacao:
        print(json.dumps({"erro": "prestacao.json não encontrado"}, ensure_ascii=False), file=sys.stderr)
        return 2

    excel = not args.sem_excel
    saida = gerar_lista_anual(raiz, prestacao, excel=excel)
    print(json.dumps(saida, ensure_ascii=False, indent=2))
    return 1 if saida.get("erro") else 0


if __name__ == "__main__":
    raise SystemExit(main())
