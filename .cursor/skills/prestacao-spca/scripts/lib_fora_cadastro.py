#!/usr/bin/env python3
"""Listas anuais: fora do cadastro (certeza) vs. precisa revisar (aproximação/abreviado)."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any

import pandas as pd
from thefuzz import fuzz

from conciliar_doacoes import limpar_pessoas, map_columns, normalize_text, read_input
from lib_paths import (
    carregar_meses,
    descobrir_base_prestacao,
    nome_estado,
    pasta_ano_prestacao,
    resolver_arquivo_mensal,
    resolver_cadastro,
)

ARQUIVO_FORA_CADASTRO = "pessoas_fora_cadastro.xlsx"
SITUACAO_NAO_CONSTA = "Não consta no cadastro (sem match exato)"
SITUACAO_REVISAR = "Precisa revisar (aproximação ou nome abreviado)"
LIMIAR_REVISAO_SCORE = 55  # token_set_ratio mínimo para sugerir candidato parcial

COLUNAS_FORA_CERTEZA = [
    ("nome", "Nome no extrato"),
    ("meses", "Meses"),
    ("qtd_transacoes", "Qtd. transações"),
    ("motivo", "Motivo"),
]

COLUNAS_PRECISA_REVISAR = [
    ("nome", "Nome no extrato"),
    ("motivo_revisao", "Motivo da revisão"),
    ("nome_cadastro_candidato", "Candidato no cadastro"),
    ("documento_candidato", "CPF/CNPJ candidato"),
    ("similaridade", "Similaridade (%)"),
    ("meses", "Meses"),
    ("qtd_transacoes", "Qtd. transações"),
]

COLUNAS_TODAS = [
    ("situacao", "Situação"),
    ("nome", "Nome no extrato"),
    ("meses", "Meses"),
    ("qtd_transacoes", "Qtd. transações"),
    ("motivo", "Motivo"),
    ("nome_cadastro_candidato", "Candidato no cadastro"),
    ("documento_candidato", "CPF/CNPJ candidato"),
    ("similaridade", "Similaridade (%)"),
]

PARTICULAS = frozenset({"DE", "DA", "DO", "DOS", "DAS", "E"})


def tokens_significativos(nome_norm: str) -> list[str]:
    return [t for t in nome_norm.split() if t and t not in PARTICULAS]


def nome_parece_abreviado(nome_norm: str) -> bool:
    tokens = tokens_significativos(nome_norm)
    if not tokens:
        return False
    if any(len(re.sub(r"\.", "", t)) == 1 for t in tokens):
        return True
    if len(tokens) == 2 and all(len(t) > 1 for t in tokens):
        ultimo = tokens[-1]
        if len(ultimo) <= 8 and ultimo not in {
            "SILVA",
            "SANTOS",
            "SOUZA",
            "COSTA",
            "OLIVEIRA",
            "LIMA",
            "ROCHA",
        }:
            return True
    return False


def melhor_candidato_cadastro(
    nome_norm: str,
    pessoas: pd.DataFrame,
) -> dict[str, Any] | None:
    if not nome_norm or pessoas.empty:
        return None
    melhor: tuple[float, pd.Series] | None = None
    for _, row in pessoas.iterrows():
        cand = row.get("nome_norm", "")
        if not cand:
            continue
        score = float(fuzz.token_set_ratio(nome_norm, cand))
        if melhor is None or score > melhor[0]:
            melhor = (score, row)
    if melhor is None:
        return None
    score, row = melhor
    doc = row.get("cpf_digits") or row.get("cnpj_digits") or ""
    return {
        "nome_cadastro": row.get("nome_original", ""),
        "documento": doc,
        "similaridade": round(score, 1),
    }


def classificar_nome_fora(
    nome_norm: str,
    pessoas: pd.DataFrame,
) -> tuple[str, dict[str, Any]]:
    """Retorna ('certeza'|'revisar', linha dict)."""
    abreviado = nome_parece_abreviado(nome_norm)
    candidato = melhor_candidato_cadastro(nome_norm, pessoas)
    score = candidato["similaridade"] if candidato else 0.0
    parcial = score >= LIMIAR_REVISAO_SCORE

    base: dict[str, Any] = {
        "nome": nome_norm,
        "meses": "",
        "qtd_transacoes": 0,
    }

    if parcial or abreviado:
        motivo = (
            "Nome abreviado/incompleto e match parcial com cadastro"
            if parcial and abreviado
            else "Match parcial com cadastro — conferir manualmente"
            if parcial
            else "Nome abreviado ou incompleto no extrato"
        )
        return "revisar", {
            **base,
            "motivo_revisao": motivo,
            "nome_cadastro_candidato": candidato["nome_cadastro"] if candidato and parcial else "",
            "documento_candidato": candidato["documento"] if candidato and parcial else "",
            "similaridade": candidato["similaridade"] if candidato and parcial else "",
        }

    return "certeza", {
        **base,
        "motivo": "Ausente no cadastro — sem match exato, parcial ou abreviado",
    }


def _carregar_pessoas(caminho: Path) -> pd.DataFrame:
    df = read_input(caminho)
    used: set[str] = set()
    maps = map_columns(
        df,
        ["nome_pessoa", "cpf_pessoa", "cnpj_pessoa", "tipo_pessoa", "status_pessoa"],
        used,
    )
    if "nome_pessoa" not in maps:
        # Cadastro TSE sem linha de cabeçalho (ex.: SC — col0=nome, col1=doc, col2=tipo, col3=status)
        from lib_paths import exportar_cadastro_csv

        import tempfile

        tmp = Path(tempfile.mkdtemp()) / "cadastro.csv"
        exportar_cadastro_csv(caminho, tmp)
        df = read_input(tmp)
        maps = map_columns(
            df,
            ["nome_pessoa", "cpf_pessoa", "cnpj_pessoa", "tipo_pessoa", "status_pessoa"],
            set(),
        )
    pessoas, _ = limpar_pessoas(df, maps)
    return pessoas


def coletar_nomes_pendencias_mes(pasta_ano: Path, slug: str) -> list[tuple[str, str, int]]:
    """(nome_extrato, mes_slug, qtd) a partir de Pendencias_e_Inconsistencias.xlsx."""
    path = resolver_arquivo_mensal(pasta_ano, slug, "Pendencias_e_Inconsistencias.xlsx")
    if not path:
        return []
    df = pd.read_excel(path, sheet_name=0)
    if df.empty:
        return []
    mes = slug
    out: list[tuple[str, str, int]] = []
    for _, row in df.iterrows():
        cat = str(row.get("categoria", "")).upper()
        if "CPF AUSENTE" not in cat and "REVISÃO MANUAL" not in cat and "REVISAO MANUAL" not in cat:
            continue
        nome = (
            row.get("Nome do Doador (PIX)")
            or row.get("Nome_PIX_original")
            or row.get("Nome do Doador")
            or ""
        )
        nome = str(nome).strip()
        if nome:
            out.append((nome, mes, 1))
    return out


def agregar_nomes(
    itens: list[tuple[str, str, int]],
) -> dict[str, dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = {}
    meses_ordem = list(carregar_meses().keys())
    for nome, mes, qtd in itens:
        norm = normalize_text(nome)
        if not norm:
            continue
        if norm not in agg:
            agg[norm] = {"nome": nome, "nome_norm": norm, "meses": [], "qtd_transacoes": 0}
        rec = agg[norm]
        if mes not in rec["meses"]:
            rec["meses"].append(mes)
        rec["qtd_transacoes"] += qtd
    for rec in agg.values():
        rec["meses"].sort(key=lambda m: meses_ordem.index(m) if m in meses_ordem else m)
    return agg


def classificar_listas(
    agg: dict[str, dict[str, Any]],
    pessoas: pd.DataFrame,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    certeza: list[dict[str, Any]] = []
    revisar: list[dict[str, Any]] = []
    for norm in sorted(agg):
        item = agg[norm]
        classe, linha = classificar_nome_fora(norm, pessoas)
        linha["nome"] = item["nome"]
        linha["meses"] = ", ".join(item["meses"])
        linha["qtd_transacoes"] = item["qtd_transacoes"]
        if classe == "revisar":
            revisar.append(linha)
        else:
            certeza.append(linha)
    return certeza, revisar


def _linhas_unificadas(certeza: list[dict], revisar: list[dict]) -> list[dict]:
    linhas: list[dict] = []
    for item in certeza:
        linhas.append(
            {
                "situacao": SITUACAO_NAO_CONSTA,
                "nome": item["nome"],
                "meses": item["meses"],
                "qtd_transacoes": item["qtd_transacoes"],
                "motivo": item.get("motivo", ""),
                "nome_cadastro_candidato": "",
                "documento_candidato": "",
                "similaridade": "",
            }
        )
    for item in revisar:
        linhas.append(
            {
                "situacao": SITUACAO_REVISAR,
                "nome": item["nome"],
                "meses": item["meses"],
                "qtd_transacoes": item["qtd_transacoes"],
                "motivo": item.get("motivo_revisao", ""),
                "nome_cadastro_candidato": item.get("nome_cadastro_candidato", ""),
                "documento_candidato": item.get("documento_candidato", ""),
                "similaridade": item.get("similaridade", ""),
            }
        )
    linhas.sort(key=lambda x: (x["situacao"], x["nome"].upper()))
    return linhas


def exportar_xlsx(
    caminho: Path,
    prestacao: dict[str, Any],
    certeza: list[dict],
    revisar: list[dict],
) -> None:
    todas = _linhas_unificadas(certeza, revisar)
    resumo = [
        {"campo": "estado", "valor": prestacao.get("estado", "")},
        {"campo": "ano", "valor": prestacao.get("ano", "")},
        {"campo": "cadastro", "valor": str(prestacao.get("cadastro", ""))},
        {"campo": "total_nao_consta", "valor": len(certeza)},
        {"campo": "total_precisa_revisar", "valor": len(revisar)},
        {"campo": "total_geral", "valor": len(todas)},
    ]
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(caminho, engine="openpyxl") as writer:
        pd.DataFrame(resumo).to_excel(writer, sheet_name="resumo", index=False)
        pd.DataFrame(todas).to_excel(writer, sheet_name="todas", index=False)
        pd.DataFrame(certeza).to_excel(writer, sheet_name="nao_consta_certeza", index=False)
        pd.DataFrame(revisar).to_excel(writer, sheet_name="precisa_revisar", index=False)


def _salvar_csv(caminho: Path, dados: list[dict], colunas: list[tuple[str, str]]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    fields = [c[0] for c in colunas]
    with caminho.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for item in dados:
            w.writerow({k: item.get(k, "") for k in fields})


def gerar_listas_fora_cadastro(
    raiz: Path,
    prestacao: dict[str, Any],
) -> dict[str, Any]:
    uf = prestacao["estado_uf"]
    ano = int(prestacao["ano"])
    estado = nome_estado(uf)
    pasta_ano = pasta_ano_prestacao(raiz, prestacao)
    base = descobrir_base_prestacao(raiz, estado)
    cadastro_path = resolver_cadastro(raiz, uf, base)
    pessoas = _carregar_pessoas(cadastro_path)

    itens: list[tuple[str, str, int]] = []
    for slug in carregar_meses():
        itens.extend(coletar_nomes_pendencias_mes(pasta_ano, slug))

    agg = agregar_nomes(itens)
    certeza, revisar = classificar_listas(agg, pessoas)

    pasta_fora = pasta_ano / "fora_cadastro"
    pasta_fora.mkdir(parents=True, exist_ok=True)
    _salvar_csv(pasta_fora / "fora_do_cadastro_definitivo.csv", certeza, COLUNAS_FORA_CERTEZA)
    _salvar_csv(pasta_fora / "precisam_revisar_cadastro.csv", revisar, COLUNAS_PRECISA_REVISAR)

    caminho_xlsx = pasta_ano / ARQUIVO_FORA_CADASTRO
    exportar_xlsx(caminho_xlsx, prestacao, certeza, revisar)

    resumo = {
        "fora_cadastro_certeza": len(certeza),
        "precisam_revisar": len(revisar),
        "total_fora": len(certeza) + len(revisar),
        "arquivos": {
            "xlsx": ARQUIVO_FORA_CADASTRO,
            "certeza": "fora_cadastro/fora_do_cadastro_definitivo.csv",
            "revisar": "fora_cadastro/precisam_revisar_cadastro.csv",
        },
    }
    (pasta_fora / "resumo.json").write_text(
        json.dumps(resumo, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    return {
        **resumo,
        "pessoas_fora_cadastro_xlsx": str(caminho_xlsx.relative_to(raiz)),
    }
