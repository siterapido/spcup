#!/usr/bin/env python3
"""
Consolida Revisao_Exportacao_SPCA.xlsx de todos os meses em planilha anual.

Saída: {Estado}/{ano}/[escopo/]Revisao_Exportacao_SPCA_Anual[-{escopo}].xlsx

Exemplo:
  gerar_revisao_anual.py --estado Paraíba --ano 2025 --raiz .
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_paths import carregar_prestacao  # noqa: E402
from lib_revisao_anual import gerar_revisao_anual  # noqa: E402
from processar_mes import resolver_contexto  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Consolida revisões mensais SPCA em planilha anual",
    )
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument(
        "--excel",
        action="store_true",
        help="Gera Revisao_Exportacao_SPCA_Anual.xlsx (default: só metadados do SQLite)",
    )
    args = parser.parse_args()

    raiz, _uf, _ano = resolver_contexto(args)
    prestacao = carregar_prestacao(raiz)
    if not prestacao:
        print(json.dumps({"erro": "prestacao.json não encontrado"}, ensure_ascii=False), file=sys.stderr)
        return 2

    meta = gerar_revisao_anual(raiz, prestacao, excel=args.excel)
    print(json.dumps(meta, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
