#!/usr/bin/env python3
"""Processa todos os meses (ou lista informada) da prestação ativa."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_paths import (  # noqa: E402
    arquivo_mes,
    carregar_meses,
    carregar_prestacao,
    dir_saida_mensal,
    escopo_prestacao,
    nome_estado,
    normalizar_uf,
    pasta_ano_prestacao,
    raiz_projeto,
    resolver_arquivo_mensal,
)
from processar_mes import processar_mes, resolver_contexto  # noqa: E402


def mes_ja_concluido(raiz: Path, uf: str, ano: int, slug: str) -> bool:
    nome = nome_estado(uf)
    escopo = escopo_prestacao(raiz)
    prestacao = carregar_prestacao(raiz) or {"estado": nome, "estado_uf": uf, "ano": ano, "escopo": escopo}
    pasta_ano = pasta_ano_prestacao(raiz, prestacao)
    resumo_path = resolver_arquivo_mensal(pasta_ano, slug, "resumo.json")
    if resumo_path and resumo_path.is_file():
        try:
            resumo = json.loads(resumo_path.read_text(encoding="utf-8"))
            return resumo.get("status") == "concluido"
        except json.JSONDecodeError:
            pass

    status_path = pasta_ano / "status.json"
    if not status_path.is_file():
        return False
    status = json.loads(status_path.read_text(encoding="utf-8"))
    mes = status.get("meses", {}).get(slug, {})
    return mes.get("status") == "concluido"


def main() -> None:
    parser = argparse.ArgumentParser(description="Processa múltiplos meses SPCA")
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    parser.add_argument("--meses", nargs="*", help="Slugs (padrão: 12 meses)")
    parser.add_argument("--forcar", action="store_true", help="Reprocessa meses já concluídos")
    parser.add_argument(
        "--pular-nlm",
        action="store_true",
        help="Reusa nlm_transacoes.json em .cache/ (debug)",
    )
    args = parser.parse_args()

    raiz, uf, ano = resolver_contexto(args)
    slugs = args.meses or list(carregar_meses().keys())

    ok: list[str] = []
    pulados: list[str] = []
    erros: dict[str, str] = {}

    for slug in slugs:
        if not args.forcar and mes_ja_concluido(raiz, uf, ano, slug):
            print(f"Pulando {slug} (já concluído; use --forcar para reprocessar)")
            pulados.append(slug)
            continue
        try:
            processar_mes(slug, raiz=raiz, uf=uf, ano=ano, pular_nlm=args.pular_nlm)
            ok.append(slug)
        except Exception as exc:
            erros[slug] = str(exc)
            print(f"ERRO {slug}: {exc}")

    print()
    print(json.dumps({"meses_ok": ok, "meses_pulados": pulados, "meses_erro": erros}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
