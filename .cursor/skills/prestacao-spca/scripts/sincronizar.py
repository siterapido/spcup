#!/usr/bin/env python3
"""
Sincroniza o projeto SPCA UP V2 com o Google Drive (Composio googlesuper).

Exemplos:
  sincronizar.py --raiz .
  sincronizar.py janeiro --raiz .
  sincronizar.py --pastas --raiz .
  sincronizar.py --mostrar --raiz .
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_paths import carregar_prestacao, nome_estado, normalizar_uf, raiz_projeto  # noqa: E402
from sync_drive import escopo_mes, load_manifest, sync  # noqa: E402


def resolver_contexto(args: argparse.Namespace) -> tuple[Path, str, int]:
    raiz = raiz_projeto(args.raiz)

    if args.estado and args.ano:
        uf = normalizar_uf(args.estado)
        return raiz, nome_estado(uf), args.ano

    prestacao = carregar_prestacao(raiz)
    if prestacao:
        estado = prestacao["estado"]
        ano = int(prestacao["ano"])
        if args.estado:
            estado = nome_estado(normalizar_uf(args.estado))
        if args.ano:
            ano = args.ano
        return raiz, estado, ano

    if args.mes:
        raise SystemExit(
            "Informe --estado e --ano, ou configure a prestação:\n"
            f"  python prestacao.py --estado Bahia --ano 2025 --raiz {raiz}"
        )

    return raiz, "", 0


def mostrar(raiz: Path) -> None:
    manifest = load_manifest(raiz)
    if not manifest:
        print("Nenhuma sincronização registrada.")
        print(f"Execute: sincronizar.py --raiz {raiz}")
        return
    resumo = {
        "root_url": manifest.get("root_url"),
        "folders": manifest.get("folders"),
        "uploaded": manifest.get("uploaded"),
        "skipped_files": manifest.get("skipped_files"),
        "synced_at": manifest.get("synced_at"),
    }
    print(json.dumps(resumo, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sincroniza pastas e arquivos do SPCA UP V2 no Google Drive"
    )
    parser.add_argument(
        "mes",
        nargs="?",
        help="Mês processado (ex: janeiro) — sincroniza saídas + cadastro + Planilhado",
    )
    parser.add_argument("--estado", help="Estado (UF ou nome). Padrão: prestacao.json")
    parser.add_argument("--ano", type=int, help="Ano civil. Padrão: prestacao.json")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto (padrão: cwd)")
    parser.add_argument(
        "--completo",
        action="store_true",
        help="Espelho legado: pastas inteiras + PDFs/JSON (lento; não recomendado)",
    )
    parser.add_argument(
        "--pastas",
        action="store_true",
        help="Só criar/verificar pastas (sem upload de arquivos)",
    )
    parser.add_argument(
        "--rel",
        action="append",
        dest="only_under",
        metavar="CAMINHO",
        help="Sincronizar só este caminho relativo (repetível)",
    )
    parser.add_argument(
        "--criar-planilha-vazia",
        action="store_true",
        help="Criar Google Sheet vazio nas pastas alvo (--mes ou --rel)",
    )
    parser.add_argument(
        "--mostrar",
        action="store_true",
        help="Exibe última sincronização (drive_manifest.json)",
    )
    args = parser.parse_args()

    raiz = raiz_projeto(args.raiz)

    if args.mostrar:
        mostrar(raiz)
        return

    only_under = list(args.only_under or [])
    if args.mes:
        _, estado, ano = resolver_contexto(args)
        only_under.extend(escopo_mes(raiz, args.mes, estado, ano))

    manifest = sync(
        raiz,
        apenas_pastas=args.pastas,
        only_under=only_under or None,
        criar_planilha_vazia=args.criar_planilha_vazia,
        modo="completo" if args.completo else "planilhas",
    )

    print()
    print("Sincronização concluída.")
    print(f"  Modo:     {manifest.get('modo', 'planilhas')}")
    print(f"  Drive:    {manifest['root_url']}")
    print(f"  Pastas:   {manifest['folders']}")
    if not args.pastas:
        print(f"  Enviados: {manifest['uploaded']}")
        print(f"  Atualiz.: {manifest.get('updated', 0)}")
        print(f"  Ignorados:{manifest['skipped_files']}")


if __name__ == "__main__":
    main()
