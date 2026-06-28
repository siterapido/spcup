#!/usr/bin/env python3
"""
Processa um mês: NotebookLM (PDFs) → JSON → conciliação SPCA (5 etapas TSE).

Sempre executa NLM fresco (limpa .cache/ antes de extrair).
`--pular-nlm` existe só para debug local — não usar em processamento normal.

Exemplos:
  processar_mes.py janeiro --estado Bahia --ano 2025 --raiz .
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tse_io import DB_PATH, PROJECT_RAIZ  # noqa: E402
from with_backup import with_backup  # noqa: E402
from conciliar_doacoes import conciliar, conciliar_dataframes, map_columns, read_input  # noqa: E402
from lib_json_fontes import carregar_fontes_json, montar_fontes_json  # noqa: E402
from lib_nlm import extrair_mes_nlm  # noqa: E402
from lib_paths import (  # noqa: E402
    arquivo_mes,
    carregar_prestacao,
    caminho_prestacao_atual,
    normalizar_uf,
    numero_mes_civil,
    raiz_projeto,
    resolver_fontes_mes,
)


def _agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def salvar_resumo(
    paths: dict,
    stats: dict,
    output_dir: Path,
    *,
    fontes_json: str | None = None,
    nlm_meta: dict | None = None,
) -> Path:
    resumo = {
        "mes": paths["mes_slug"],
        "mes_nome": paths["mes_nome"],
        "estado": paths["estado"],
        "estado_uf": paths["estado_uf"],
        "ano": paths["ano"],
        "status": "concluido",
        "processado_em": _agora(),
        "cred_pix": stats["cred_pix"],
        "sucesso": stats["sucesso"],
        "pendencias": stats["pendencias"],
        "excecoes": stats["excecoes"],
        "sem_par": stats["sem_par"],
        "linhas_pdf": stats.get("linhas_pdf"),
        "linhas_mes": stats.get("linhas_mes"),
        "linhas_vazamento": stats.get("linhas_vazamento"),
        "path_sucesso": stats["path_sucesso"],
        "path_pendencias": stats["path_pendencias"],
        "path_exportacao_mensal": stats.get("path_exportacao_mensal", ""),
        "path_revisao_exportacao": stats.get("path_revisao_exportacao", ""),
        "db_path": stats.get("db_path", ""),
        "db_prontas": stats.get("db_prontas"),
        "db_bloqueadas": stats.get("db_bloqueadas"),
        "elegivel_xml": stats.get("elegivel_xml"),
        "revisao_exportacao_erro": stats.get("revisao_exportacao_erro"),
        "revisao_db_erro": stats.get("revisao_db_erro"),
        "entrada_total": str(paths.get("path_total") or ""),
        "entrada_pix": str(paths.get("path_pix") or ""),
        "entrada_pessoas": str(paths.get("path_pessoas") or ""),
        "fontes_json": fontes_json,
        "nlm": nlm_meta,
    }
    destino = output_dir / arquivo_mes(paths["mes_slug"], "resumo.json")
    destino.write_text(json.dumps(resumo, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return destino


def atualizar_status_mes(raiz: Path, paths: dict, stats: dict) -> None:
    escopo = paths.get("escopo")
    base_ano = raiz / paths["estado"] / str(paths["ano"])
    if escopo:
        base_ano = base_ano / escopo
    status_path = base_ano / "status.json"
    status_path.parent.mkdir(parents=True, exist_ok=True)

    if status_path.is_file():
        status = json.loads(status_path.read_text(encoding="utf-8"))
    else:
        status = {"meses": {}}

    status.setdefault("estado", paths["estado"])
    status.setdefault("estado_uf", paths["estado_uf"])
    status.setdefault("ano", paths["ano"])
    status["meses"][paths["mes_slug"]] = {
        "status": "concluido",
        "sucesso": stats["sucesso"],
        "pendencias": stats["pendencias"],
        "cred_pix": stats["cred_pix"],
        "processado_em": _agora(),
        "path_sucesso": stats["path_sucesso"],
        "path_pendencias": stats["path_pendencias"],
        "path_exportacao_mensal": stats.get("path_exportacao_mensal", ""),
    }
    status["atualizado_em"] = _agora()
    status_path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def resolver_contexto(args: argparse.Namespace) -> tuple[Path, str, int]:
    raiz = raiz_projeto(args.raiz)

    if args.estado and args.ano:
        uf = normalizar_uf(args.estado)
        return raiz, uf, args.ano

    prestacao = carregar_prestacao(raiz)
    if prestacao:
        uf = prestacao["estado_uf"]
        ano = int(prestacao["ano"])
        if args.estado:
            uf = normalizar_uf(args.estado)
        if args.ano:
            ano = args.ano
        return raiz, uf, ano

    raise SystemExit(
        "Informe --estado e --ano, ou configure a prestação:\n"
        f"  python prestacao.py --estado Bahia --ano 2025 --raiz {raiz}"
    )


def _tem_entrada_tabular(paths: dict) -> bool:
    return bool(paths.get("path_total") and paths.get("path_pix") and paths.get("path_pessoas"))


def _gravar_revisao_db(
    raiz: Path,
    paths: dict,
    stats: dict,
    *,
    pdfs: list[Path] | None = None,
    df_total: pd.DataFrame | None = None,
    cache_dir: Path | None = None,
) -> dict:
    revisao_db = raiz.resolve() / "scripts" / "revisao_db"
    if not revisao_db.is_dir():
        raise FileNotFoundError(
            f"Módulo revisao_db ausente em `{revisao_db}` — rode na raiz do projeto SPCA UP V2."
        )
    if str(revisao_db) not in sys.path:
        sys.path.insert(0, str(revisao_db))
    from sync import gravar_mes_db  # noqa: WPS433

    return gravar_mes_db(
        raiz, paths, stats, pdfs=pdfs, df_total=df_total, cache_dir=cache_dir
    )


def processar_mes(
    mes: str,
    *,
    raiz: Path,
    uf: str,
    ano: int,
    pular_nlm: bool = False,
    excel: bool = False,
) -> dict:
    paths = resolver_fontes_mes(raiz, uf, mes, ano)
    paths["output_dir"].mkdir(parents=True, exist_ok=True)

    print(f"Processando {paths['mes_nome']} — {paths['estado']} ({paths['estado_uf']}) · {ano}")

    fontes_json: str | None = None
    nlm_meta: dict | None = None
    df_total: pd.DataFrame | None = None
    cache_dir = Path(paths["cache_dir"])

    if _tem_entrada_tabular(paths):
        print(f"  Total:   {paths['path_total'].name}")
        print(f"  PIX:     {paths['path_pix'].name}")
        print(f"  Pessoas: {paths['path_pessoas'].name}")
        mes_civil = numero_mes_civil(paths["mes_slug"])
        meta = {
            "estado": paths["estado"],
            "estado_uf": paths["estado_uf"],
            "ano": paths["ano"],
            "mes_nome": paths["mes_nome"],
            "mes_slug": paths["mes_slug"],
        }
        stats = conciliar(
            paths["path_total"],
            paths["path_pix"],
            paths["path_pessoas"],
            paths["output_dir"],
            mes_civil=mes_civil,
            ano=ano,
            meta=meta,
            cache_dir=cache_dir,
            excel_mensal=excel,
        )
        if (cache_dir / "fontes.json").is_file():
            df_total, _, _ = carregar_fontes_json(cache_dir)
        elif paths.get("path_total"):
            raw = read_input(Path(paths["path_total"]))
            used: set[str] = set()
            maps_total = map_columns(
                raw,
                ["data_total", "valor_total", "documento_total", "historico_total"],
                used,
            )
            std_cols = {
                "data_total": "Data",
                "valor_total": "Valor",
                "documento_total": "Documento",
                "historico_total": "Histórico",
            }
            rename = {maps_total[k]: std_cols[k] for k in std_cols if k in maps_total}
            df_total = raw.rename(columns=rename)
            keep = [std_cols[k] for k in std_cols if k in maps_total]
            if keep:
                df_total = df_total[keep]
    else:
        precisa_nlm = bool(paths["pdfs_total"] or paths["pdfs_pix"] or paths.get("pdf_pessoas"))
        if not precisa_nlm:
            raise FileNotFoundError(
                "Sem CSV/XLSX nem PDFs no mês. Coloque extratos em "
                f"`{paths['pasta_total']}` e PIX em Planilhado ou Extrato total PIX."
            )
        print("  Fonte:   NotebookLM → JSON (.cache/)")
        if paths["pdfs_total"]:
            print(f"  PDFs total: {len(paths['pdfs_total'])}")
        if paths["pdfs_pix"]:
            print(f"  PDFs PIX:   {len(paths['pdfs_pix'])}")
        if paths.get("pasta_planilhado"):
            print(f"  Planilhado: {paths['pasta_planilhado']}")

        nlm_meta = extrair_mes_nlm(paths, pular_nlm=pular_nlm)
        fontes_path = montar_fontes_json(paths, nlm_meta=nlm_meta)
        fontes_json = str(fontes_path)
        print(f"  fontes.json: {fontes_path.name}")

        df_total, df_pix, df_pessoas = carregar_fontes_json(cache_dir)
        mes_civil = numero_mes_civil(paths["mes_slug"])
        meta = {
            "estado": paths["estado"],
            "estado_uf": paths["estado_uf"],
            "ano": paths["ano"],
            "mes_nome": paths["mes_nome"],
            "mes_slug": paths["mes_slug"],
        }
        stats = conciliar_dataframes(
            df_total,
            df_pix,
            df_pessoas,
            paths["output_dir"],
            mes_civil=mes_civil,
            ano=ano,
            meta=meta,
            cache_dir=cache_dir,
            excel_mensal=excel,
        )

    pdfs = list(paths.get("pdfs_total") or []) + list(paths.get("pdfs_pix") or [])

    if excel:
        try:
            from lib_revisao_exportacao import gerar_revisao_mes

            revisao_meta = gerar_revisao_mes(raiz, paths, stats, pdfs=pdfs)
            stats["path_revisao_exportacao"] = revisao_meta.get("path_revisao", "")
            stats["elegivel_xml"] = revisao_meta.get("elegivel_xml", False)
        except Exception as exc:  # noqa: BLE001 — não aborta conciliação
            stats["revisao_exportacao_erro"] = str(exc)
    else:
        # Backup automático do DB canônico antes da mutação de revisão.
        # O decorator injeta DB_PATH como 1º arg posicional de _gravar_revisao_db.
        @with_backup(DB_PATH)
        def _gravar_revisao_com_backup(path, raiz, paths, stats, pdfs, df_total, cache_dir):
            return _gravar_revisao_db(
                raiz, paths, stats, pdfs=pdfs, df_total=df_total, cache_dir=cache_dir
            )

        try:
            db_meta = _gravar_revisao_com_backup(
                raiz, paths, stats, pdfs=pdfs, df_total=df_total, cache_dir=cache_dir
            )
            stats["db_path"] = db_meta.get("db_path", "")
            stats["db_prontas"] = db_meta.get("prontas", 0)
            stats["db_bloqueadas"] = db_meta.get("bloqueadas", 0)
            stats["db_extrato_linhas"] = db_meta.get("extrato_linhas", 0)
            stats["elegivel_xml"] = db_meta.get("elegivel_xml", False)
        except Exception as exc:  # noqa: BLE001 — não aborta conciliação
            stats["revisao_db_erro"] = str(exc)

    resumo_path = salvar_resumo(
        paths,
        stats,
        paths["output_dir"],
        fontes_json=fontes_json,
        nlm_meta=nlm_meta,
    )
    atualizar_status_mes(raiz, paths, stats)

    stats["resumo_json"] = str(resumo_path)
    stats.update({k: paths[k] for k in ("mes_slug", "mes_nome", "estado", "estado_uf", "ano")})
    if fontes_json:
        stats["fontes_json"] = fontes_json
    if nlm_meta:
        stats["nlm"] = nlm_meta
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Processa conciliação SPCA de um mês (NLM + JSON ou CSV/XLSX)"
    )
    parser.add_argument("mes", help="Slug do mês (ex: janeiro, marco)")
    parser.add_argument("--estado", help="UF ou nome do estado (ex: BA, Bahia)")
    parser.add_argument("--ano", type=int, help="Ano da prestação (ex: 2025)")
    parser.add_argument("--raiz", type=Path, help="Raiz do projeto (padrão: cwd)")
    parser.add_argument(
        "--pular-nlm",
        action="store_true",
        help="[DEBUG] Reusa nlm_transacoes.json — não usar em processamento normal",
    )
    parser.add_argument(
        "--excel",
        action="store_true",
        help="Gera Revisao_Exportacao_SPCA.xlsx (legado). Default: grava só no SQLite.",
    )
    args = parser.parse_args()

    raiz, uf, ano = resolver_contexto(args)
    stats = processar_mes(
        args.mes, raiz=raiz, uf=uf, ano=ano, pular_nlm=args.pular_nlm, excel=args.excel
    )

    print()
    print("Conciliação concluída.")
    print(f"  CRED PIX:   {stats['cred_pix']}")
    print(f"  Sucesso:    {stats['sucesso']} → {stats['path_sucesso']}")
    print(f"  Pendências: {stats['pendencias']} → {stats['path_pendencias']}")
    if stats.get("path_exportacao_mensal"):
        print(f"  Exportação: {stats['path_exportacao_mensal']}")
    if stats.get("db_path"):
        print(
            f"  SQLite:     {stats['db_path']} "
            f"({stats.get('db_prontas', 0)} prontas, {stats.get('db_bloqueadas', 0)} bloqueadas)"
        )
        if stats.get("elegivel_xml") is not None:
            print(f"  Elegível XML: {'sim' if stats['elegivel_xml'] else 'não'}")
    elif stats.get("revisao_db_erro"):
        print(f"  SQLite:     ERRO — {stats['revisao_db_erro']}")
    if stats.get("path_revisao_exportacao"):
        print(f"  Revisão SPCA: {stats['path_revisao_exportacao']}")
    elif stats.get("revisao_exportacao_erro"):
        print(f"  Revisão SPCA: ERRO — {stats['revisao_exportacao_erro']}")
    print(f"  Resumo:     {stats['resumo_json']}")
    if stats.get("fontes_json"):
        print(f"  Fontes:     {stats['fontes_json']}")


if __name__ == "__main__":
    main()
