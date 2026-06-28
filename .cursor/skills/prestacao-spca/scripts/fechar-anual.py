#!/usr/bin/env python3
"""Wrapper CLI de fechamento anual SPCA.

Uso:
    .venv/bin/python scripts/fechar-anual.py --uf BA --ano 2025
    .venv/bin/python scripts/fechar-anual.py --uf PB --ano 2025 --escopo campina-grande
    .venv/bin/python scripts/fechar-anual.py --uf BA --ano 2025 --pular-xml --dry-run

Faz:
1. Backup de prestacao.json e swap para estado/ano/escopo alvo
2. Auditar bloqueadas contra cadastro (validar_extrato_vs_revisao.py — a criar)
3. Importar planilha anual para SQLite (importar_revisao_anual.py — a criar)
4. Gerar XML anual (delega para gerar_xml_origem_recurso.py)
5. Validar XML (validar_xml_antes_envio.py)
6. Restaurar prestacao.json original
7. Abrir Finder na pasta de saída

Em qualquer exceção, prestacao.json é restaurado antes de sair.

LIMITACOES CONHECIDAS (issue #5 da auditoria):
- Os scripts ``validar_extrato_vs_revisao.py`` e ``importar_revisao_anual.py``
  ainda NAO EXISTEM. O fluxo de validacao + importacao esta desativado por
  padrao; use ``--pular-validacao`` para explicitar. A geracao de XML usa
  ``gerar_xml_origem_recurso.py`` (existe) — o que difere do design original
  "XML anual" (a saida fica por mes, nao consolidada anual).
- A lógica vive em ``fechar_anual.py`` (importável) para que os testes
  pytest possam importar as funções diretamente. Este arquivo é só o
  shim de linha de comando.
"""
import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from fechar_anual import (  # noqa: E402
    PROJECT_RAIZ,
    UF_NOME,
    build_prestacao_json,
    restore_prestacao,
    run_step,
    swap_prestacao,
)


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Wrapper de fechamento anual SPCA.",
    )
    parser.add_argument("--uf", required=True, help="Ex: BA, SC, PB")
    parser.add_argument("--ano", type=int, required=True)
    parser.add_argument("--escopo", default="", help="Vazio para estadual")
    parser.add_argument("--pular-xml", action="store_true", help="Não gerar XML")
    parser.add_argument(
        "--pular-validacao", action="store_true",
        help="Não validar planilha × extrato (no-op: script ainda não existe)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Mostra comandos sem executar",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    """Orquestra o fechamento anual.

    Returns o exit code (0 sucesso, !=0 falha). Em qualquer exceção dentro
    do bloco ``try``, ``prestacao.json`` é restaurado antes de sair graças
    ao ``finally``.
    """
    args = parse_args(argv)

    if args.uf not in UF_NOME:
        print(
            f"❌ UF inválida: {args.uf}. Use uma de: {list(UF_NOME.keys())}",
            file=sys.stderr,
        )
        return 2
    estado_nome = UF_NOME[args.uf]

    if not PROJECT_RAIZ.exists():
        print(f"❌ Projeto SPCA não encontrado: {PROJECT_RAIZ}", file=sys.stderr)
        return 1

    prestacao_json = PROJECT_RAIZ / "resultados" / "prestacao.json"
    if not prestacao_json.exists():
        print(
            f"❌ prestacao.json não encontrado: {prestacao_json}",
            file=sys.stderr,
        )
        return 1

    if args.dry_run:
        print(
            f"[DRY-RUN] swap {prestacao_json} → {estado_nome} {args.ano} "
            f"escopo='{args.escopo}'"
        )
        print(f"[DRY-RUN] Validar: {'skip' if args.pular_validacao else 'sim'}")
        print(f"[DRY-RUN] XML: {'skip' if args.pular_xml else 'sim'}")
        return 0

    # 1. Swap
    novo = build_prestacao_json(args, estado_nome)
    swap_prestacao(prestacao_json, novo)
    print(
        f"🔄 prestacao.json → {estado_nome} {args.ano} escopo='{args.escopo}'"
    )

    try:
        # 2. Validar planilha × extrato (issue #5: script não existe ainda)
        if not args.pular_validacao:
            print(
                "⚠️  scripts/validar_extrato_vs_revisao.py não existe. "
                "Use --pular-validacao para suprimir este aviso."
            )

        # 3-5. Importar (issue #5: não existe) + gerar XML + validar XML
        if not args.pular_xml:
            run_step("Gerar XML mensal (todos os meses elegíveis)", [
                sys.executable,
                "scripts/gerar_xml_origem_recurso.py",
                "--estado", estado_nome,
                "--ano", str(args.ano),
            ])
            xml_path = (
                PROJECT_RAIZ / estado_nome / str(args.ano) / "exportacao"
                / f"{args.uf.lower()}-{args.ano}-origemRecurso.xml"
            )
            if xml_path.exists():
                run_step("Validar XML", [
                    sys.executable,
                    str(
                        Path.home()
                        / ".cursor/skills/prestacao-spca/scripts/validar_xml_antes_envio.py"
                    ),
                    str(xml_path),
                ])
            else:
                print(f"⚠️  XML não encontrado em {xml_path}")
    finally:
        restore_prestacao(prestacao_json)
        # abrir Finder na saída
        saida = PROJECT_RAIZ / estado_nome / str(args.ano) / "exportacao"
        if saida.exists() and sys.platform == "darwin":
            subprocess.run(["open", str(saida)])

    print(f"\n🎉 Fechamento anual {estado_nome} {args.ano} concluído.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
