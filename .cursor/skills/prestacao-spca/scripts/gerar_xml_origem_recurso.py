#!/usr/bin/env python3
"""Gera XML origemRecurso (SPCA) para meses elegíveis da revisão."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_paths import resolver_mes  # noqa: E402
from lib_xml_origem_recurso import gerar_xml_lote, resolver_estado_ano  # noqa: E402
from lib_paths import raiz_projeto  # noqa: E402


def _parse_meses(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    meses: list[str] = []
    for parte in raw.split(","):
        slug, _ = resolver_mes(parte.strip())
        meses.append(slug)
    return meses


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera XML origemRecurso SPCA (lote mensal)")
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument(
        "--meses",
        help="Meses separados por vírgula (ex: janeiro,marco). Default: todos elegíveis.",
    )
    args = parser.parse_args()

    raiz = raiz_projeto(args.raiz)
    estado, uf, ano = resolver_estado_ano(raiz, args.estado, args.ano)
    meses = _parse_meses(args.meses)

    resultado = gerar_xml_lote(raiz, estado=estado, estado_uf=uf, ano=ano, meses=meses)
    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    print(f"\nPasta: {resultado['pasta_exportacao']}")
    print(f"Gerados: {len(resultado['gerados'])} · Pulados: {len(resultado['pulados'])}")
    for item in resultado["gerados"]:
        print(f"  ✓ {item['mes']}: {item['path']} ({item['origens']} origens)")
    for item in resultado["pulados"]:
        print(f"  − {item['mes']}: {item.get('motivo', 'não elegível')}")


if __name__ == "__main__":
    main()
