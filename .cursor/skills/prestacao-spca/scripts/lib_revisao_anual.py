#!/usr/bin/env python3
"""Consolida revisões mensais SPCA em planilha anual (prontas + bloqueadas)."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from lib_paths import (
    carregar_meses,
    pasta_ano_prestacao,
    resolver_arquivo_mensal,
)
from lib_revisao_exportacao import (
    ABA_BLOQUEADAS,
    ABA_PRONTAS,
    ABA_RESUMO,
    COLS_BLOQUEADAS,
    COLS_PRONTAS,
)

# Decorator de backup automático (mesmo padrão de lib_revisao_exportacao.py e
# lib_xml_origem_recurso.py). Usado em gerar_revisao_anual() para regravação
# segura da planilha anual consolidada.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from with_backup import with_backup  # noqa: E402

ORDEM_MESES = [
    "janeiro",
    "fevereiro",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
]

ARQUIVO_REVISAO_ANUAL = "Revisao_Exportacao_SPCA_Anual.xlsx"


def nome_arquivo_revisao_anual(escopo: str | None = None) -> str:
    if escopo:
        return f"Revisao_Exportacao_SPCA_Anual-{escopo}.xlsx"
    return ARQUIVO_REVISAO_ANUAL


def _agora() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _valor_resumo(resumo: pd.DataFrame, campo: str) -> str:
    if resumo.empty or "campo" not in resumo.columns:
        return ""
    hits = resumo[resumo["campo"] == campo]
    return str(hits.iloc[0]["valor"]) if not hits.empty else ""


def gerar_revisao_anual(
    raiz: Path,
    prestacao: dict[str, Any],
    *,
    excel: bool = False,
) -> dict[str, Any]:
    """Consolida revisão anual — SQLite por padrão; Excel com excel=True."""
    raiz = raiz.resolve()
    revisao_db = raiz / "scripts" / "revisao_db"
    if revisao_db.is_dir():
        import sys

        if str(revisao_db) not in sys.path:
            sys.path.insert(0, str(revisao_db))
        try:
            from anuais import gerar_revisao_anual_db

            prestacao = {**prestacao, "pasta_ano": str(pasta_ano_prestacao(raiz, prestacao))}
            return gerar_revisao_anual_db(raiz, prestacao, excel=excel)
        except SystemExit:
            if not excel:
                raise
        except Exception:
            if not excel:
                raise

    pasta_ano = pasta_ano_prestacao(raiz, prestacao)
    meses_cfg = carregar_meses()
    escopo = str(prestacao.get("escopo") or "").strip() or None

    prontas_all: list[pd.DataFrame] = []
    bloq_all: list[pd.DataFrame] = []
    resumos: list[dict[str, str]] = []

    for slug in ORDEM_MESES:
        cfg = meses_cfg.get(slug, {})
        mes_nome = cfg["nome"] if isinstance(cfg, dict) else str(cfg)
        path = resolver_arquivo_mensal(pasta_ano, slug, "Revisao_Exportacao_SPCA.xlsx")
        if not path:
            resumos.append(
                {"mes": slug, "mes_nome": mes_nome, "status": "revisao_ausente"}
            )
            continue

        try:
            prontas = pd.read_excel(path, sheet_name=ABA_PRONTAS, dtype=str)
            bloq = pd.read_excel(path, sheet_name=ABA_BLOQUEADAS, dtype=str)
            resumo = pd.read_excel(path, sheet_name=ABA_RESUMO, dtype=str)
        except Exception as exc:
            resumos.append(
                {"mes": slug, "mes_nome": mes_nome, "status": f"erro: {exc}"}
            )
            continue

        if not prontas.empty:
            prontas = prontas.copy()
            prontas.insert(0, "mes_nome", mes_nome)
            prontas.insert(0, "mes", slug)
            prontas_all.append(prontas)
        if not bloq.empty:
            bloq = bloq.copy()
            bloq.insert(0, "mes_nome", mes_nome)
            bloq.insert(0, "mes", slug)
            bloq_all.append(bloq)

        resumos.append(
            {
                "mes": slug,
                "mes_nome": mes_nome,
                "prontas": str(len(prontas)),
                "bloqueadas": str(len(bloq)),
                "aprovadas": _valor_resumo(resumo, "Prontas aprovadas (S)"),
                "elegivel_xml": _valor_resumo(resumo, "Mês elegível para XML"),
                "cnpj_prestador": _valor_resumo(resumo, "CNPJ prestador"),
                "nome_diretorio": _valor_resumo(resumo, "Diretório"),
            }
        )

    df_prontas = (
        pd.concat(prontas_all, ignore_index=True)
        if prontas_all
        else pd.DataFrame(columns=["mes", "mes_nome"] + COLS_PRONTAS)
    )
    df_bloq = (
        pd.concat(bloq_all, ignore_index=True)
        if bloq_all
        else pd.DataFrame(columns=["mes", "mes_nome"] + COLS_BLOQUEADAS)
    )
    df_resumo_mensal = pd.DataFrame(resumos)

    aprovadas = 0
    if not df_prontas.empty and "aprovado" in df_prontas.columns:
        aprovadas = int(
            (df_prontas["aprovado"].astype(str).str.upper().str.strip() == "S").sum()
        )

    meses_ok = [r["mes"] for r in resumos if "status" not in r]
    resumo_anual = pd.DataFrame(
        [
            {"campo": "Estado", "valor": prestacao.get("estado", "")},
            {"campo": "UF", "valor": prestacao.get("estado_uf", "")},
            {"campo": "Escopo", "valor": escopo or ""},
            {"campo": "Ano", "valor": str(prestacao.get("ano", ""))},
            {"campo": "CNPJ prestador", "valor": prestacao.get("cnpj_prestador", "")},
            {"campo": "Meses com revisão", "valor": str(len(meses_ok))},
            {"campo": "Total prontas_exportar", "valor": str(len(df_prontas))},
            {"campo": "Total aprovadas (S)", "valor": str(aprovadas)},
            {"campo": "Total bloqueadas", "valor": str(len(df_bloq))},
            {"campo": "Gerado em", "valor": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
        ]
    )

    meta: dict[str, Any] = {
        "fonte": "excel_legado",
        "prontas": len(df_prontas),
        "aprovadas": aprovadas,
        "bloqueadas": len(df_bloq),
        "meses": meses_ok,
        "gerado_em": _agora(),
    }
    if excel:
        dest = pasta_ano / nome_arquivo_revisao_anual(escopo)

        def _escrever_xlsx_anual(target: Path) -> None:
            """Escreve planilha anual consolidada no destino."""
            with pd.ExcelWriter(target, engine="openpyxl") as writer:
                df_prontas.to_excel(writer, sheet_name=ABA_PRONTAS, index=False)
                df_bloq.to_excel(writer, sheet_name=ABA_BLOQUEADAS, index=False)
                df_resumo_mensal.to_excel(writer, sheet_name="resumo_mensal", index=False)
                resumo_anual.to_excel(writer, sheet_name=ABA_RESUMO, index=False)

        if dest.is_file():
            # Regravação: backup binário + restauração em falha.
            @with_backup(dest)
            def _salvar_xlsx_anual_com_backup(target: Path) -> None:
                _escrever_xlsx_anual(target)

            _salvar_xlsx_anual_com_backup()
        else:
            # 1ª escrita: grava direto (sem estado anterior a preservar).
            _escrever_xlsx_anual(dest)

        meta["arquivo"] = str(dest)
        (pasta_ano / "revisao_anual_resumo.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return meta
