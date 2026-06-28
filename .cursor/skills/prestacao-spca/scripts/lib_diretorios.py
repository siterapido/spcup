#!/usr/bin/env python3
"""Planilha de diretórios (CNPJ prestador + conta bancária) — exportação SPCA."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd

from lib_paths import carregar_prestacao, raiz_projeto

COLUNAS = [
    "cnpj_prestador",
    "nome_diretorio",
    "estado_uf",
    "ano",
    "nr_banco",
    "agencia",
    "dv_agencia",
    "conta",
    "dv_conta",
    "observacoes",
]

ARQUIVO_DIRETORIOS = "diretorios.xlsx"
ABA_DIRETORIOS = "diretorios"


def caminho_diretorios(raiz: Path | None = None) -> Path:
    return raiz_projeto(raiz) / ARQUIVO_DIRETORIOS


def only_digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def normalizar_cnpj(value: Any) -> str:
    texto = str(value or "").strip()
    if not texto or texto.lower() in ("nan", "none"):
        return ""
    return re.sub(r"[^A-Z0-9]", "", texto.upper())


def _df_vazio() -> pd.DataFrame:
    return pd.DataFrame(columns=COLUNAS)


def garantir_planilha_diretorios(raiz: Path | None = None) -> Path:
    """Cria diretorios.xlsx na raiz se ausente."""
    path = caminho_diretorios(raiz)
    if path.is_file():
        return path
    raiz = raiz_projeto(raiz)
    raiz.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "cnpj_prestador": "",
            "nome_diretorio": "UP Bahia",
            "estado_uf": "BA",
            "ano": 2025,
            "nr_banco": "",
            "agencia": "",
            "dv_agencia": "",
            "conta": "",
            "dv_conta": "",
            "observacoes": "Preencher CNPJ prestador e dados bancários",
        },
        {
            "cnpj_prestador": "",
            "nome_diretorio": "UP Santa Catarina",
            "estado_uf": "SC",
            "ano": 2025,
            "nr_banco": "",
            "agencia": "",
            "dv_agencia": "",
            "conta": "",
            "dv_conta": "",
            "observacoes": "Preencher CNPJ prestador e dados bancários",
        },
    ]
    df = pd.DataFrame(rows, columns=COLUNAS)
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=ABA_DIRETORIOS, index=False)
    return path


def carregar_diretorios(raiz: Path | None = None) -> pd.DataFrame:
    path = garantir_planilha_diretorios(raiz)
    df = pd.read_excel(path, sheet_name=ABA_DIRETORIOS, dtype=str)
    for col in COLUNAS:
        if col not in df.columns:
            df[col] = ""
    if "ano" in df.columns:
        df["ano"] = pd.to_numeric(df["ano"], errors="coerce").astype("Int64")
    df["_cnpj_norm"] = df["cnpj_prestador"].map(normalizar_cnpj)
    return df


def salvar_diretorios(df: pd.DataFrame, raiz: Path | None = None) -> Path:
    path = caminho_diretorios(raiz)
    out = df.reindex(columns=COLUNAS).copy()
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        out.to_excel(writer, sheet_name=ABA_DIRETORIOS, index=False)
    return path


def _conta_chave(row: pd.Series) -> tuple[str, str, str]:
    return (
        only_digits(row.get("nr_banco")),
        only_digits(row.get("agencia")),
        only_digits(row.get("conta")),
    )


def filtrar_diretorios(df: pd.DataFrame, estado_uf: str, ano: int) -> pd.DataFrame:
    uf = str(estado_uf or "").upper().strip()
    sub = df[df["estado_uf"].astype(str).str.upper().str.strip() == uf].copy()
    sub = sub[sub["ano"].astype(int) == int(ano)]
    return sub.reset_index(drop=True)


def resolver_diretorio(
    raiz: Path,
    *,
    estado_uf: str,
    ano: int,
    cnpj_prestador: str | None = None,
    conta_extrato: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Escolhe linha da planilha:
    1. cnpj_prestador explícito (prestacao.json)
    2. match banco+agência+conta do extrato
    3. única linha para UF+ano
    """
    df = filtrar_diretorios(carregar_diretorios(raiz), estado_uf, ano)
    if df.empty:
        raise ValueError(
            f"Nenhum diretório em {ARQUIVO_DIRETORIOS} para {estado_uf}/{ano}. "
            "Cadastre CNPJ e conta bancária."
        )

    cnpj_busca = normalizar_cnpj(cnpj_prestador or "")
    if not cnpj_busca:
        prestacao = carregar_prestacao(raiz) or {}
        cnpj_busca = normalizar_cnpj(prestacao.get("cnpj_prestador") or "")

    # Pitfall (PB/BA municipais com mesmo CNPJ raiz): se a UF tem mais de
    # um diretório cadastrado, NÃO confiar só no CNPJ — pode haver
    # colisão entre estadual/municipais. Exigir match por banco+agência+conta
    # do extrato (quando disponível) ou erro explícito.
    multi_diretorio_uf = len(df) > 1
    if cnpj_busca and not multi_diretorio_uf:
        hits = df[df["_cnpj_norm"] == cnpj_busca]
        if len(hits) == 1:
            return hits.iloc[0].to_dict()
        if len(hits) > 1:
            raise ValueError(f"CNPJ {cnpj_busca} duplicado em {ARQUIVO_DIRETORIOS}.")

    if conta_extrato:
        chave = (
            only_digits(conta_extrato.get("nr_banco")),
            only_digits(conta_extrato.get("agencia")),
            only_digits(conta_extrato.get("conta")),
        )
        if all(chave):
            matches = []
            for _, row in df.iterrows():
                if _conta_chave(row) == chave:
                    matches.append(row)
            if len(matches) == 1:
                return matches[0].to_dict()
            if len(matches) > 1:
                raise ValueError("Conta bancária do extrato bate com mais de um diretório.")
            # matches == 0: cai no erro abaixo

    if cnpj_busca and multi_diretorio_uf:
        # Defesa: CNPJ bateu com 1 linha mas UF tem múltiplos diretórios.
        # Pode ser colisão entre estadual/municipais com mesmo CNPJ raiz
        # (PB JP e CG já colidiram em jun/2026) ou CNPJ errado no prestacao.json.
        hits = df[df["_cnpj_norm"] == cnpj_busca]
        if len(hits) >= 1:
            nomes = [r.get("nome_diretorio") for _, r in hits.iterrows()]
            raise ValueError(
                f"CNPJ {cnpj_busca} bate com {len(hits)} diretório(s) em "
                f"{ARQUIVO_DIRETORIOS} para {estado_uf}/{ano}: {nomes}. "
                f"UF tem {len(df)} diretórios cadastrados — passar conta_extrato "
                f"(banco+agência+conta) para desambiguar, ou conferir se o "
                f"cnpj_prestador no prestacao.json é o CNPJ real do diretório."
            )

    if len(df) == 1:
        row = df.iloc[0].to_dict()
        if not normalizar_cnpj(row.get("cnpj_prestador")):
            raise ValueError(
                f"Preencha cnpj_prestador em {ARQUIVO_DIRETORIOS} "
                f"({row.get('nome_diretorio')})."
            )
        return row

    raise ValueError(
        f"Mais de um diretório para {estado_uf}/{ano}. "
        "Defina cnpj_prestador em resultados/prestacao.json."
    )


def _extrair_texto_pdf(pdf: Path, max_paginas: int = 2) -> str:
    try:
        import fitz  # pymupdf
    except ImportError as exc:
        raise RuntimeError("pymupdf necessário para ler cabeçalho do extrato.") from exc
    doc = fitz.open(pdf)
    partes: list[str] = []
    for i in range(min(max_paginas, len(doc))):
        partes.append(doc[i].get_text())
    doc.close()
    return "\n".join(partes)


def extrair_conta_de_texto(texto: str) -> dict[str, str]:
    """Extrai banco/agência/conta do cabeçalho do extrato (BB/Caixa comuns)."""
    t = texto.replace("\xa0", " ")
    out: dict[str, str] = {}

    m_banco = re.search(r"\b(?:banco|cod\.?\s*banco)\s*[:\s]*(\d{1,5})\b", t, re.I)
    if m_banco:
        out["nr_banco"] = m_banco.group(1).zfill(3)[:5]
    elif re.search(r"banco\s+do\s+brasil", t, re.I):
        out["nr_banco"] = "001"
    elif re.search(r"caixa\s+econ", t, re.I):
        out["nr_banco"] = "104"

    m_ag = re.search(
        r"ag[eê]ncia\s*[:\s]*(\d{1,5})\s*[-/]?\s*(\d{0,2})?",
        t,
        re.I,
    )
    if m_ag:
        out["agencia"] = m_ag.group(1)
        if m_ag.group(2):
            out["dv_agencia"] = m_ag.group(2)

    m_cc = re.search(
        r"(?:conta(?:\s+corrente)?|c/c)\s*[:\s]*(\d{1,20})\s*[-/]\s*(\d{1,2})",
        t,
        re.I,
    )
    if m_cc:
        out["conta"] = m_cc.group(1)
        out["dv_conta"] = m_cc.group(2)
    else:
        m_cc2 = re.search(r"(?:conta(?:\s+corrente)?|c/c)\s*[:\s]*(\d{3,20})", t, re.I)
        if m_cc2:
            out["conta"] = m_cc2.group(1)

    return out


def extrair_conta_de_pdf(pdf: Path) -> dict[str, str]:
    if not pdf.is_file():
        return {}
    return extrair_conta_de_texto(_extrair_texto_pdf(pdf))


def atualizar_banco_de_pdfs(
    raiz: Path,
    *,
    estado_uf: str,
    ano: int,
    pdfs: list[Path],
) -> dict[str, Any]:
    """
    Preenche nr_banco/agencia/conta/dv na planilha se células vazias.
    Nunca altera CNPJ. Retorna metadados do que foi atualizado.
    """
    conta: dict[str, str] = {}
    for pdf_raw in pdfs:
        pdf = Path(pdf_raw)
        conta = extrair_conta_de_pdf(pdf)
        if conta.get("agencia") and conta.get("conta"):
            break

    meta: dict[str, Any] = {"conta_extrato": conta, "atualizado": False, "campos": []}
    if not conta:
        return meta

    df = carregar_diretorios(raiz)
    sub_idx = filtrar_diretorios(df, estado_uf, ano).index
    if len(sub_idx) != 1:
        meta["motivo"] = "vários ou nenhum diretório — não auto-atualiza"
        return meta

    idx = sub_idx[0]
    mapa = {
        "nr_banco": "nr_banco",
        "agencia": "agencia",
        "dv_agencia": "dv_agencia",
        "conta": "conta",
        "dv_conta": "dv_conta",
    }
    for campo_planilha, campo_extrato in mapa.items():
        atual = str(df.at[idx, campo_planilha] or "").strip()
        novo = str(conta.get(campo_extrato) or "").strip()
        if not atual and novo:
            df.at[idx, campo_planilha] = novo
            meta["campos"].append(campo_planilha)
            meta["atualizado"] = True

    if meta["atualizado"]:
        salvar_diretorios(df, raiz)
    return meta


def validar_diretorio_para_export(diretorio: dict[str, Any]) -> list[str]:
    erros: list[str] = []
    if not normalizar_cnpj(diretorio.get("cnpj_prestador")):
        erros.append("cnpj_prestador ausente")
    for campo in ("nr_banco", "agencia", "conta", "dv_conta"):
        if not str(diretorio.get(campo) or "").strip():
            erros.append(f"{campo} ausente")
    return erros
