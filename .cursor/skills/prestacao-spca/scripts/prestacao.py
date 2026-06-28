#!/usr/bin/env python3
"""Configura prestação ativa (estado + ano + raiz) para processamento mensal."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from lib_paths import (
    caminho_prestacao_atual,
    descobrir_base_prestacao,
    detectar_modelo_extrato,
    nome_estado,
    normalizar_uf,
    raiz_projeto,
    resolver_pasta_fontes,
)


def _agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def configurar(
    estado: str,
    ano: int,
    raiz: Path,
    cnpj_prestador: str | None = None,
    *,
    escopo: str | None = None,
    base_prestacao: str | None = None,
) -> dict:
    uf = normalizar_uf(estado)
    nome = nome_estado(uf)
    if base_prestacao:
        base = raiz / base_prestacao
        if not base.is_dir():
            raise FileNotFoundError(f"Base de prestação não encontrada: {base}")
        base_rel = base_prestacao
    else:
        fontes = resolver_pasta_fontes(raiz, nome)
        if fontes:
            base = fontes
            try:
                base_rel = str(fontes.relative_to(raiz))
            except ValueError:
                base_rel = str(fontes)
        else:
            base = descobrir_base_prestacao(raiz, nome)
            try:
                base_rel = str(base.relative_to(raiz))
            except ValueError:
                base_rel = str(base)

    dados = {
        "estado": nome,
        "estado_uf": uf,
        "ano": ano,
        "raiz": str(raiz),
        "base_prestacao": base_rel,
        "modelo_extrato": detectar_modelo_extrato(raiz, base),
        "atualizado_em": _agora(),
    }
    if escopo:
        dados["escopo"] = escopo
    if cnpj_prestador:
        from lib_diretorios import normalizar_cnpj

        dados["cnpj_prestador"] = normalizar_cnpj(cnpj_prestador)

    destino = caminho_prestacao_atual(raiz)
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(dados, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return dados


def mostrar(raiz: Path) -> None:
    caminho = caminho_prestacao_atual(raiz)
    if not caminho.is_file():
        print("Nenhuma prestação configurada.")
        print(f"Configure com: prestacao.py --estado Bahia --ano 2025 --raiz {raiz}")
        return
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    print(json.dumps(dados, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Configura prestação SPCA (estado + ano)")
    parser.add_argument("--estado", help="UF ou nome (ex: BA, Bahia)")
    parser.add_argument("--ano", type=int, help="Ano da prestação (ex: 2025)")
    parser.add_argument(
        "--cnpj-prestador",
        help="CNPJ do diretório prestador (14 caracteres, alfanumérico TSE)",
    )
    parser.add_argument(
        "--escopo",
        help="Escopo municipal (ex.: joao-pessoa) — saídas em {ano}/{escopo}/{mes}/",
    )
    parser.add_argument(
        "--base-prestacao",
        help="Caminho relativo da pasta de fontes (ex.: Paraíba/municipios/joao-pessoa)",
    )
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto (padrão: cwd)")
    parser.add_argument("--mostrar", action="store_true", help="Exibe prestação ativa")
    args = parser.parse_args()

    raiz = raiz_projeto(args.raiz)

    if args.mostrar:
        mostrar(raiz)
        return

    if not args.estado or not args.ano:
        raise SystemExit("Informe --estado e --ano, ou use --mostrar.")

    dados = configurar(
        args.estado,
        args.ano,
        raiz,
        cnpj_prestador=args.cnpj_prestador,
        escopo=args.escopo,
        base_prestacao=args.base_prestacao,
    )
    print(f"Prestação configurada: {dados['estado']} ({dados['estado_uf']}) · {dados['ano']}")
    print(f"Base: {dados['base_prestacao']}")
    print(f"Arquivo: {caminho_prestacao_atual(raiz)}")


if __name__ == "__main__":
    main()
