#!/usr/bin/env python3
"""Gera Revisao_Exportacao_SPCA.xlsx para um mês (sem reprocessar conciliação)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib_paths import arquivo_mes, carregar_prestacao, normalizar_uf, pasta_ano_prestacao, raiz_projeto, resolver_arquivo_mensal, resolver_fontes_mes  # noqa: E402
from lib_revisao_exportacao import gerar_revisao_mes  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera revisão SPCA origemRecurso para um mês")
    parser.add_argument("mes", help="Slug do mês (ex: janeiro)")
    parser.add_argument("--estado", help="UF ou nome do estado")
    parser.add_argument("--ano", type=int, help="Ano da prestação")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto")
    args = parser.parse_args()

    raiz = raiz_projeto(args.raiz)
    prestacao = carregar_prestacao(raiz)
    if args.estado and args.ano:
        uf = normalizar_uf(args.estado)
        ano = args.ano
    elif prestacao:
        uf = prestacao["estado_uf"]
        ano = int(prestacao["ano"])
        if args.estado:
            uf = normalizar_uf(args.estado)
        if args.ano:
            ano = args.ano
    else:
        raise SystemExit("Informe --estado e --ano")

    paths = resolver_fontes_mes(raiz, uf, args.mes, ano)
    prestacao = prestacao or {"estado": paths["estado"], "estado_uf": uf, "ano": ano, "escopo": paths.get("escopo")}
    pasta_ano = pasta_ano_prestacao(raiz, prestacao)
    resumo_path = resolver_arquivo_mensal(pasta_ano, paths["mes_slug"], "resumo.json")
    if not resumo_path:
        raise SystemExit(
            f"Processe o mês antes: {pasta_ano / 'mensal' / arquivo_mes(paths['mes_slug'], 'resumo.json')} ausente"
        )

    stats = json.loads(resumo_path.read_text(encoding="utf-8"))
    stats["path_sucesso"] = stats.get("path_sucesso") or str(
        paths["output_dir"] / arquivo_mes(paths["mes_slug"], "Consolidado_SPCA_Sucesso.xlsx")
    )
    stats["path_pendencias"] = stats.get("path_pendencias") or str(
        paths["output_dir"] / arquivo_mes(paths["mes_slug"], "Pendencias_e_Inconsistencias.xlsx")
    )

    pdfs = list(paths.get("pdfs_total") or []) + list(paths.get("pdfs_pix") or [])
    resultado = gerar_revisao_mes(raiz, paths, stats, pdfs=pdfs)

    print(json.dumps(resultado, ensure_ascii=False, indent=2))
    print(f"\nRevisão: {resultado['path_revisao']}")
    if resultado.get("erros_diretorio"):
        print("Avisos diretório:", "; ".join(resultado["erros_diretorio"]))
    if resultado.get("elegivel_xml"):
        print("Mês elegível para gerar-xml.")
    else:
        print("XML bloqueado:", "; ".join(resultado.get("motivos_xml") or []))


if __name__ == "__main__":
    main()
