#!/usr/bin/env python3
"""Exportação mensal padrão — planilha multi-abas SPCA."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pandas as pd

from conciliar_doacoes import documento_extrato_bb_chaves, is_cred_pix_recebido, normalize_historico
from lib_lista_anual import _nome_doador, _parse_valor
from lib_nlm import is_nlm_pix_recebido

ARQUIVO_EXPORTACAO = "Exportacao_Mensal.xlsx"

ABAS = (
    "Resumo",
    "Pessoas sem cpf",
    "Pessoas fora do cadastro",
    "Entradas não identificadas",
    "Pendências",
)


def _motivo_fora_cadastro(motivo: Any) -> bool:
    return "fora do cadastro" in str(motivo or "").lower()


def _categoria_cpf_pendente(categoria: Any) -> bool:
    cat = str(categoria or "").upper()
    return "CPF AUSENTE" in cat or "REVISÃO MANUAL" in cat or "REVISAO MANUAL" in cat


def _is_taxa(tipo: str, historico: str = "") -> bool:
    texto = f"{tipo} {historico}".lower()
    return any(k in texto for k in ("tarifa", "tar ", "manut", "pacote de servi"))


def _is_entrada_nao_identificada(tx: dict[str, Any]) -> bool:
    if str(tx.get("direcao") or "").lower() != "entrada":
        return False
    if is_nlm_pix_recebido(tx):
        return False
    tipo = str(tx.get("tipo") or "").lower()
    hist = normalize_historico(tx.get("tipo") or "")
    if is_cred_pix_recebido(hist):
        return False
    return True


def _ler_nlm(cache_dir: Path) -> list[dict[str, Any]]:
    path = cache_dir / "nlm_transacoes.json"
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("transacoes", [])
    except json.JSONDecodeError:
        return []


def _estatisticas_movimentacao(
    transacoes: list[dict[str, Any]],
    excecoes: pd.DataFrame,
) -> dict[str, Any]:
    entradas = [t for t in transacoes if str(t.get("direcao") or "").lower() == "entrada"]
    saidas = [t for t in transacoes if str(t.get("direcao") or "").lower() == "saida"]
    taxas = [t for t in transacoes if _is_taxa(str(t.get("tipo") or ""))]
    nao_id_nlm = [t for t in transacoes if _is_entrada_nao_identificada(t)]

    valor_entradas = round(sum(float(t.get("valor") or 0) for t in entradas), 2)
    valor_saidas = round(sum(float(t.get("valor") or 0) for t in saidas), 2)
    valor_taxas = round(sum(float(t.get("valor") or 0) for t in taxas), 2)

    return {
        "total_movimentacoes": len(transacoes) if transacoes else len(excecoes),
        "entradas_qtd": len(entradas),
        "entradas_valor": valor_entradas,
        "saidas_qtd": len(saidas),
        "saidas_valor": valor_saidas,
        "taxas_qtd": len(taxas),
        "taxas_valor": valor_taxas,
        "nao_identificadas_nlm": nao_id_nlm,
    }


def _formatar_cpf_cnpj(raw: str) -> str:
    cpf, cnpj = documento_extrato_bb_chaves(raw)
    d = cpf or cnpj or re.sub(r"\D", "", raw)
    if len(d) == 11:
        return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return raw


def montar_aba_resumo(
    *,
    meta: dict[str, Any],
    stats: dict[str, Any],
    mov: dict[str, Any],
    pendencias: pd.DataFrame,
    qtd_sem_cpf: int,
    qtd_fora_cadastro: int,
    entradas_nao_id: pd.DataFrame,
) -> pd.DataFrame:
    linhas = [
        {"secao": "Identificação", "campo": "Estado", "valor": meta.get("estado", "")},
        {"secao": "Identificação", "campo": "UF", "valor": meta.get("estado_uf", "")},
        {"secao": "Identificação", "campo": "Ano", "valor": str(meta.get("ano", ""))},
        {"secao": "Identificação", "campo": "Mês", "valor": meta.get("mes_nome", "")},
        {"secao": "Movimentação (extrato)", "campo": "Total de movimentações", "valor": str(mov["total_movimentacoes"])},
        {"secao": "Movimentação (extrato)", "campo": "Entradas (qtd)", "valor": str(mov["entradas_qtd"])},
        {"secao": "Movimentação (extrato)", "campo": "Entradas (valor R$)", "valor": str(mov["entradas_valor"])},
        {"secao": "Movimentação (extrato)", "campo": "Saídas (qtd)", "valor": str(mov["saidas_qtd"])},
        {"secao": "Movimentação (extrato)", "campo": "Saídas (valor R$)", "valor": str(mov["saidas_valor"])},
        {"secao": "Movimentação (extrato)", "campo": "Taxas e tarifas (qtd)", "valor": str(mov["taxas_qtd"])},
        {"secao": "Movimentação (extrato)", "campo": "Taxas e tarifas (valor R$)", "valor": str(mov["taxas_valor"])},
        {"secao": "Doações PIX", "campo": "CRED PIX / Pix recebido", "valor": str(stats.get("cred_pix", 0))},
        {"secao": "Doações PIX", "campo": "Conciliadas com sucesso", "valor": str(stats.get("sucesso", 0))},
        {"secao": "Pendências", "campo": "Pessoas sem CPF (revisão)", "valor": str(qtd_sem_cpf)},
        {"secao": "Pendências", "campo": "Pessoas fora do cadastro", "valor": str(qtd_fora_cadastro)},
        {
            "secao": "Pendências",
            "campo": "Entradas não identificadas (TED/TEV etc.)",
            "valor": str(len(entradas_nao_id)),
        },
        {"secao": "Pendências", "campo": "PIX sem par", "valor": str(stats.get("sem_par", 0))},
        {"secao": "Pendências", "campo": "Não PIX (exceções no total)", "valor": str(stats.get("excecoes", 0))},
        {"secao": "Pendências", "campo": "Total de pendências", "valor": str(len(pendencias))},
        {"secao": "Consolidado", "campo": "Linhas extrato total (mês civil)", "valor": str(stats.get("linhas_mes", ""))},
        {"secao": "Consolidado", "campo": "Linhas PDF", "valor": str(stats.get("linhas_pdf", ""))},
        {"secao": "Consolidado", "campo": "Vazamento fronteira PDF", "valor": str(stats.get("linhas_vazamento", ""))},
    ]
    return pd.DataFrame(linhas)


def _agregar_pessoas_pendencia(df: pd.DataFrame, *, incluir_cpf: bool) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(
            columns=["nome", "cpf_extrato", "qtd_transacoes", "valor_total", "motivo", "metodo_fuzzy"]
        )

    agg: dict[str, dict[str, Any]] = {}
    for _, row in df.iterrows():
        nome = _nome_doador(row)
        if not nome:
            continue
        cpf_raw = str(row.get("CPF_extrato") or row.get("cpf_extrato") or "")
        cpf_fmt = _formatar_cpf_cnpj(cpf_raw) if cpf_raw else ""
        chave = f"{nome.upper()}|{cpf_fmt}" if incluir_cpf else nome.upper()
        if chave not in agg:
            agg[chave] = {
                "nome": nome,
                "cpf_extrato": cpf_fmt,
                "qtd_transacoes": 0,
                "valor_total": 0.0,
                "motivo": str(row.get("motivo", "") or row.get("categoria", "")),
                "metodo_fuzzy": str(row.get("Metodo_fuzzy", "") or ""),
            }
        rec = agg[chave]
        rec["qtd_transacoes"] += 1
        rec["valor_total"] += _parse_valor(row.get("Valor"))

    out = []
    for rec in agg.values():
        rec["valor_total"] = round(rec["valor_total"], 2)
        if not incluir_cpf:
            rec.pop("cpf_extrato", None)
        out.append(rec)
    return pd.DataFrame(out).sort_values("nome") if out else pd.DataFrame()


def montar_entradas_nao_identificadas(
    transacoes: list[dict[str, Any]],
    excecoes: pd.DataFrame,
    maps_total: dict[str, str],
) -> pd.DataFrame:
    linhas: list[dict[str, Any]] = []

    for tx in transacoes:
        if not _is_entrada_nao_identificada(tx):
            continue
        data = str(tx.get("data") or "")[:10]
        if data and "-" in data:
            y, m, d = data.split("-")
            data = f"{d}/{m}/{y}"
        linhas.append(
            {
                "data": data,
                "valor": tx.get("valor"),
                "documento": tx.get("numero_documento") or "",
                "historico": tx.get("tipo") or "",
                "tipo": tx.get("tipo") or "",
                "remetente": tx.get("remetente_destinatario") or "",
                "motivo": "Entrada sem identificação de doador (ex.: TED/TEV)",
            }
        )

    if not excecoes.empty:
        hist_col = maps_total.get("historico_total", "Histórico")
        data_col = maps_total.get("data_total", "Data")
        val_col = maps_total.get("valor_total", "Valor")
        doc_col = maps_total.get("documento_total", "Documento")
        for _, row in excecoes.iterrows():
            hist = str(row.get(hist_col, row.get("_historico_norm", "")))
            hist_norm = normalize_historico(hist)
            if is_cred_pix_recebido(hist_norm):
                continue
            linhas.append(
                {
                    "data": row.get(data_col, ""),
                    "valor": row.get(val_col, ""),
                    "documento": row.get(doc_col, ""),
                    "historico": hist,
                    "tipo": hist,
                    "remetente": "",
                    "motivo": hist_norm or "Não PIX no extrato total",
                }
            )

    if not linhas:
        return pd.DataFrame(
            columns=["data", "valor", "documento", "historico", "tipo", "remetente", "motivo"]
        )
    return pd.DataFrame(linhas)


def _pendencias_legiveis(pendencias: pd.DataFrame) -> pd.DataFrame:
    if pendencias.empty:
        return pd.DataFrame()
    out = pendencias.copy()
    if "CPF_extrato" in out.columns:
        out["CPF_extrato"] = out["CPF_extrato"].map(
            lambda v: _formatar_cpf_cnpj(str(v)) if v is not None and str(v).strip() not in ("", "nan") else ""
        )
    cols_pref = [
        "categoria",
        "motivo",
        "Data",
        "Valor",
        "Documento",
        "Histórico",
        "Nome do Doador (PIX)",
        "Nome_PIX_original",
        "CPF_extrato",
        "Metodo_fuzzy",
        "Score_fuzzy",
        "Par_PIX_metodo",
    ]
    cols = [c for c in cols_pref if c in out.columns]
    rest = [c for c in out.columns if c not in cols and not str(c).startswith("_")]
    return out.reindex(columns=cols + rest)


def exportar_planilha_mensal(
    output_dir: Path,
    *,
    pendencias: pd.DataFrame,
    excecoes: pd.DataFrame,
    stats: dict[str, Any],
    meta: dict[str, Any],
    maps_total: dict[str, str],
    cache_dir: Path | None = None,
    mes_slug: str | None = None,
) -> Path:
    """Gera Exportacao_Mensal.xlsx com abas padrão."""
    output_dir.mkdir(parents=True, exist_ok=True)
    from lib_paths import arquivo_mes

    nome_arquivo = arquivo_mes(mes_slug, ARQUIVO_EXPORTACAO) if mes_slug else ARQUIVO_EXPORTACAO
    destino = output_dir / nome_arquivo
    cache = cache_dir or (output_dir / ".cache")

    transacoes = _ler_nlm(cache)
    mov = _estatisticas_movimentacao(transacoes, excecoes)

    cpf_pend = pendencias[pendencias["categoria"].map(_categoria_cpf_pendente)] if not pendencias.empty else pd.DataFrame()
    sem_cpf = (
        cpf_pend[~cpf_pend["motivo"].map(_motivo_fora_cadastro)]
        if not cpf_pend.empty
        else pd.DataFrame()
    )
    fora = (
        cpf_pend[cpf_pend["motivo"].map(_motivo_fora_cadastro)]
        if not cpf_pend.empty
        else pd.DataFrame()
    )
    pendencias_completas = pendencias.copy()

    entradas_nao_id = montar_entradas_nao_identificadas(transacoes, excecoes, maps_total)
    sem_cpf_df = _agregar_pessoas_pendencia(sem_cpf, incluir_cpf=False)
    fora_df = _agregar_pessoas_pendencia(fora, incluir_cpf=True)

    resumo = montar_aba_resumo(
        meta=meta,
        stats=stats,
        mov=mov,
        pendencias=pendencias_completas,
        qtd_sem_cpf=len(sem_cpf_df),
        qtd_fora_cadastro=len(fora_df),
        entradas_nao_id=entradas_nao_id,
    )

    with pd.ExcelWriter(destino, engine="openpyxl") as writer:
        resumo.to_excel(writer, sheet_name="Resumo", index=False)
        sem_cpf_df.to_excel(writer, sheet_name="Pessoas sem cpf", index=False)
        fora_df.to_excel(writer, sheet_name="Pessoas fora do cadastro", index=False)
        entradas_nao_id.to_excel(writer, sheet_name="Entradas não identificadas", index=False)
        _pendencias_legiveis(pendencias_completas).to_excel(writer, sheet_name="Pendências", index=False)

    return destino

