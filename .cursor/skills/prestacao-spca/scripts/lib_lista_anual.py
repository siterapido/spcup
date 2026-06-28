#!/usr/bin/env python3
"""Consolida relatório anual: pendências, movimentações, doações e resumos."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from conciliar_doacoes import filtrar_extrato_mes_civil, is_cred_pix_recebido, normalize_historico
from lib_paths import carregar_meses, numero_mes_civil, nome_estado, pasta_ano_prestacao, resolver_arquivo_mensal, PASTA_CACHE

ARQUIVO_LISTA_ANUAL = "lista-anual.xlsx"
ARQUIVO_FORA_CADASTRO = "pessoas_fora_cadastro.xlsx"

COLUNAS_PESSOAS_SEM_CPF = [
    "nome",
    "meses",
    "qtd_transacoes",
    "valor_total",
    "motivo",
    "metodo_fuzzy",
    "score_fuzzy",
]

COLUNAS_ENTRADAS_NAO_PIX = [
    "mes",
    "data",
    "valor",
    "documento",
    "historico",
    "motivo",
]

COLUNAS_MOVIMENTACOES = [
    "mes",
    "data",
    "valor",
    "documento",
    "historico",
    "tipo",
]

COLUNAS_DOACOES = [
    "mes",
    "data",
    "valor",
    "documento",
    "historico",
    "nome_doador",
    "cpf_valido",
    "cnpj",
    "tipo_pessoa",
    "metodo_fuzzy",
    "score_fuzzy",
]

COLUNAS_PIX_SEM_PAR = [
    "mes",
    "data",
    "valor",
    "documento",
    "historico",
    "motivo",
    "nome_pix",
]

COLUNAS_RESUMO_MENSAL = [
    "mes",
    "mes_nome",
    "cred_pix",
    "sucesso",
    "pendencias",
    "linhas_consolidadas",
    "linhas_pdf",
    "vazamento",
    "valor_doacoes_ok",
]


def _categoria_sem_cpf(categoria: str) -> bool:
    cat = str(categoria or "").upper()
    return "CPF AUSENTE" in cat or "REVISÃO MANUAL" in cat or "REVISAO MANUAL" in cat


def _categoria_nao_pix(categoria: str) -> bool:
    cat = str(categoria or "").strip().upper()
    return cat in {"NÃO PIX", "NAO PIX"}


def _categoria_pix_sem_par(categoria: str) -> bool:
    return str(categoria or "").strip().upper() == "PIX SEM PAR"


def _nome_doador(row: pd.Series) -> str:
    for col in ("Nome do Doador (PIX)", "Nome_PIX_original", "Nome do Doador"):
        val = row.get(col)
        if val is not None and str(val).strip() and str(val).strip().lower() != "nan":
            return str(val).strip()
    return ""


def _ler_pendencias_mes(pasta_ano: Path, slug: str) -> pd.DataFrame:
    path = resolver_arquivo_mensal(pasta_ano, slug, "Pendencias_e_Inconsistencias.xlsx")
    if not path:
        return pd.DataFrame()
    df = pd.read_excel(path, sheet_name=0)
    if df.empty:
        return df
    df = df.copy()
    df["mes"] = slug
    return df


def _ler_sucesso_mes(pasta_ano: Path, slug: str) -> pd.DataFrame:
    path = resolver_arquivo_mensal(pasta_ano, slug, "Consolidado_SPCA_Sucesso.xlsx")
    if not path:
        return pd.DataFrame()
    df = pd.read_excel(path, sheet_name=0)
    if df.empty:
        return df
    df = df.copy()
    df["mes"] = slug
    return df


def _ler_resumo_mes(pasta_ano: Path, slug: str) -> dict[str, Any]:
    path = resolver_arquivo_mensal(pasta_ano, slug, "resumo.json")
    if not path:
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _cache_fontes_mes(pasta_ano: Path, slug: str) -> Path | None:
    candidatos = [
        pasta_ano / "mensal" / PASTA_CACHE / slug / "fontes.json",
        pasta_ano / slug / PASTA_CACHE / "fontes.json",
    ]
    for path in candidatos:
        if path.is_file():
            return path
    return None


def _ler_extrato_total_mes(pasta_ano: Path, slug: str, ano: int) -> pd.DataFrame:
    path = _cache_fontes_mes(pasta_ano, slug)
    if not path:
        return pd.DataFrame()
    try:
        dados = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return pd.DataFrame()
    linhas = dados.get("extrato_total") or []
    if not linhas:
        return pd.DataFrame()
    df = pd.DataFrame(linhas)
    if "Data" not in df.columns:
        return pd.DataFrame()
    mes_civil = numero_mes_civil(slug)
    filtrado, _ = filtrar_extrato_mes_civil(df, "Data", mes_civil, ano)
    if filtrado.empty:
        return pd.DataFrame()
    out = filtrado.copy()
    out["mes"] = slug
    return out


def _parse_valor(valor: Any) -> float:
    if valor is None or (isinstance(valor, float) and pd.isna(valor)):
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    texto = str(valor).strip().replace(".", "").replace(",", ".")
    try:
        return float(texto)
    except ValueError:
        return 0.0


def _ordenar_por_mes(linhas: list[dict[str, Any]], chave_mes: str = "mes") -> list[dict[str, Any]]:
    meses_ordem = list(carregar_meses().keys())
    return sorted(
        linhas,
        key=lambda x: (
            meses_ordem.index(x[chave_mes]) if x.get(chave_mes) in meses_ordem else 99,
            str(x.get("data", "")),
        ),
    )


def agregar_pessoas_sem_cpf(linhas: pd.DataFrame) -> list[dict[str, Any]]:
    if linhas.empty:
        return []

    meses_ordem = list(carregar_meses().keys())
    agg: dict[str, dict[str, Any]] = {}

    for _, row in linhas.iterrows():
        nome = _nome_doador(row)
        if not nome:
            continue
        chave = nome.upper()
        if chave not in agg:
            agg[chave] = {
                "nome": nome,
                "meses": [],
                "qtd_transacoes": 0,
                "valor_total": 0.0,
                "motivo": str(row.get("motivo", "") or row.get("categoria", "")),
                "metodo_fuzzy": str(row.get("Metodo_fuzzy", "") or ""),
                "score_fuzzy": row.get("Score_fuzzy", ""),
            }
        rec = agg[chave]
        mes = str(row.get("mes", ""))
        if mes and mes not in rec["meses"]:
            rec["meses"].append(mes)
        rec["qtd_transacoes"] += 1
        rec["valor_total"] += _parse_valor(row.get("Valor"))

    out: list[dict[str, Any]] = []
    for chave in sorted(agg):
        rec = agg[chave]
        rec["meses"] = ", ".join(
            sorted(rec["meses"], key=lambda m: meses_ordem.index(m) if m in meses_ordem else m)
        )
        rec["valor_total"] = round(rec["valor_total"], 2)
        if rec["score_fuzzy"] != "" and not pd.isna(rec["score_fuzzy"]):
            rec["score_fuzzy"] = round(float(rec["score_fuzzy"]), 1)
        else:
            rec["score_fuzzy"] = ""
        out.append(rec)
    return out


def montar_entradas_nao_pix(linhas: pd.DataFrame) -> list[dict[str, Any]]:
    if linhas.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in linhas.iterrows():
        out.append(
            {
                "mes": row.get("mes", ""),
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": row.get("Documento", ""),
                "historico": row.get("Histórico", ""),
                "motivo": row.get("motivo", "") or row.get("Histórico", ""),
            }
        )
    return _ordenar_por_mes(out)


def montar_pix_sem_par(linhas: pd.DataFrame) -> list[dict[str, Any]]:
    if linhas.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in linhas.iterrows():
        out.append(
            {
                "mes": row.get("mes", ""),
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": row.get("Documento", ""),
                "historico": row.get("Histórico", ""),
                "motivo": row.get("motivo", ""),
                "nome_pix": _nome_doador(row),
            }
        )
    return _ordenar_por_mes(out)


def montar_movimentacoes_consolidadas(linhas: pd.DataFrame) -> list[dict[str, Any]]:
    if linhas.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in linhas.iterrows():
        hist = str(row.get("Histórico", "") or "")
        hist_norm = normalize_historico(hist)
        tipo = "CRED PIX (doação)" if is_cred_pix_recebido(hist_norm) else hist.strip() or "Outro"
        out.append(
            {
                "mes": row.get("mes", ""),
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": row.get("Documento", ""),
                "historico": hist,
                "tipo": tipo,
            }
        )
    return _ordenar_por_mes(out)


def montar_doacoes_conciliadas(linhas: pd.DataFrame) -> list[dict[str, Any]]:
    if linhas.empty:
        return []
    out: list[dict[str, Any]] = []
    for _, row in linhas.iterrows():
        score = row.get("Score_fuzzy", "")
        if score != "" and not pd.isna(score):
            score = round(float(score), 1)
        else:
            score = ""
        out.append(
            {
                "mes": row.get("mes", ""),
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": row.get("Documento", ""),
                "historico": row.get("Histórico", ""),
                "nome_doador": row.get("Nome do Doador", ""),
                "cpf_valido": row.get("CPF Válido", ""),
                "cnpj": row.get("CNPJ", ""),
                "tipo_pessoa": row.get("Tipo de Pessoa", ""),
                "metodo_fuzzy": row.get("Metodo_fuzzy", ""),
                "score_fuzzy": score,
            }
        )
    return _ordenar_por_mes(out)


def montar_resumo_mensal(pasta_ano: Path) -> list[dict[str, Any]]:
    meses_meta = carregar_meses()
    out: list[dict[str, Any]] = []
    for slug, meta in meses_meta.items():
        resumo = _ler_resumo_mes(pasta_ano, slug)
        if not resumo:
            continue
        sucesso_df = _ler_sucesso_mes(pasta_ano, slug)
        valor_ok = round(sum(_parse_valor(v) for v in sucesso_df.get("Valor", [])), 2) if not sucesso_df.empty else 0.0
        out.append(
            {
                "mes": slug,
                "mes_nome": meta.get("nome", resumo.get("mes_nome", slug)),
                "cred_pix": resumo.get("cred_pix", 0),
                "sucesso": resumo.get("sucesso", 0),
                "pendencias": resumo.get("pendencias", 0),
                "linhas_consolidadas": resumo.get("linhas_mes", 0),
                "linhas_pdf": resumo.get("linhas_pdf", 0),
                "vazamento": resumo.get("linhas_vazamento", 0),
                "valor_doacoes_ok": valor_ok,
            }
        )
    return out


def montar_informacoes_uteis(
    prestacao: dict[str, Any],
    resumo_mensal: list[dict[str, Any]],
    contagens: dict[str, Any],
) -> list[dict[str, str]]:
    total_cred = sum(int(r.get("cred_pix", 0)) for r in resumo_mensal)
    total_sucesso = sum(int(r.get("sucesso", 0)) for r in resumo_mensal)
    total_pend = sum(int(r.get("pendencias", 0)) for r in resumo_mensal)
    total_consolidadas = sum(int(r.get("linhas_consolidadas", 0)) for r in resumo_mensal)
    total_valor_ok = round(sum(float(r.get("valor_doacoes_ok", 0)) for r in resumo_mensal), 2)

    linhas: list[dict[str, str]] = [
        {"secao": "Prestação", "campo": "Estado", "valor": str(prestacao.get("estado", ""))},
        {"secao": "Prestação", "campo": "UF", "valor": str(prestacao.get("estado_uf", ""))},
        {"secao": "Prestação", "campo": "Ano", "valor": str(prestacao.get("ano", ""))},
        {"secao": "Prestação", "campo": "Meses processados", "valor": str(len(resumo_mensal))},
        {"secao": "Totais anuais", "campo": "CRED PIX (doações)", "valor": str(total_cred)},
        {"secao": "Totais anuais", "campo": "Doações conciliadas", "valor": str(total_sucesso)},
        {"secao": "Totais anuais", "campo": "Pendências", "valor": str(total_pend)},
        {"secao": "Totais anuais", "campo": "Movimentações consolidadas (extrato total)", "valor": str(total_consolidadas)},
        {"secao": "Totais anuais", "campo": "Valor doações conciliadas (R$)", "valor": f"{total_valor_ok:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")},
        {"secao": "Pendências anuais", "campo": "Pessoas sem CPF (únicas)", "valor": str(contagens.get("total_pessoas_sem_cpf", 0))},
        {"secao": "Pendências anuais", "campo": "Transações sem CPF", "valor": str(contagens.get("transacoes_sem_cpf", 0))},
        {"secao": "Pendências anuais", "campo": "Entradas não-PIX", "valor": str(contagens.get("total_entradas_nao_pix", 0))},
        {"secao": "Pendências anuais", "campo": "PIX sem par", "valor": str(contagens.get("total_pix_sem_par", 0))},
        {"secao": "Cadastro", "campo": "Fora do cadastro (total)", "valor": str(contagens.get("total_fora_cadastro", 0))},
        {"secao": "Cadastro", "campo": "Não consta (certeza)", "valor": str(contagens.get("fora_cadastro_certeza", 0))},
        {"secao": "Cadastro", "campo": "Precisa revisar", "valor": str(contagens.get("precisam_revisar", 0))},
        {"secao": "Abas deste arquivo", "campo": "informacoes_uteis", "valor": "Resumo geral e totais"},
        {"secao": "Abas deste arquivo", "campo": "resumo_mensal", "valor": "Indicadores mês a mês"},
        {"secao": "Abas deste arquivo", "campo": "movimentacoes_consolidadas", "valor": "Extrato total no mês civil (todas as linhas)"},
        {"secao": "Abas deste arquivo", "campo": "doacoes_conciliadas", "valor": "Doações PIX com CPF validado no cadastro"},
        {"secao": "Abas deste arquivo", "campo": "pessoas_sem_cpf", "valor": "Doadores agregados sem CPF no cadastro"},
        {"secao": "Abas deste arquivo", "campo": "entradas_nao_pix", "valor": "TED/TEV, tarifas e demais lançamentos não-PIX"},
        {"secao": "Abas deste arquivo", "campo": "pix_sem_par", "valor": "CRED PIX sem detalhe no extrato PIX"},
        {"secao": "Abas deste arquivo", "campo": "fora_cadastro", "valor": "Pessoas ausentes ou com match parcial no cadastro"},
    ]
    return linhas


def _ler_fora_cadastro(pasta_ano: Path) -> pd.DataFrame:
    path = pasta_ano / ARQUIVO_FORA_CADASTRO
    if not path.is_file():
        return pd.DataFrame()
    try:
        return pd.read_excel(path, sheet_name="todas")
    except (ValueError, OSError):
        return pd.DataFrame()


def _ler_fora_cadastro_resumo(pasta_ano: Path) -> dict[str, Any]:
    path = pasta_ano / "fora_cadastro" / "resumo.json"
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def coletar_pendencias_ano(pasta_ano: Path) -> tuple[pd.DataFrame, list[str]]:
    partes: list[pd.DataFrame] = []
    meses_ok: list[str] = []
    for slug in carregar_meses():
        df = _ler_pendencias_mes(pasta_ano, slug)
        if df.empty:
            continue
        partes.append(df)
        meses_ok.append(slug)
    if not partes:
        return pd.DataFrame(), []
    return pd.concat(partes, ignore_index=True, sort=False), meses_ok


def coletar_sucesso_ano(pasta_ano: Path) -> pd.DataFrame:
    partes: list[pd.DataFrame] = []
    for slug in carregar_meses():
        df = _ler_sucesso_mes(pasta_ano, slug)
        if not df.empty:
            partes.append(df)
    if not partes:
        return pd.DataFrame()
    return pd.concat(partes, ignore_index=True, sort=False)


def coletar_movimentacoes_ano(pasta_ano: Path, ano: int) -> pd.DataFrame:
    partes: list[pd.DataFrame] = []
    for slug in carregar_meses():
        df = _ler_extrato_total_mes(pasta_ano, slug, ano)
        if not df.empty:
            partes.append(df)
    if not partes:
        return pd.DataFrame()
    return pd.concat(partes, ignore_index=True, sort=False)


def _escrever_aba(writer: pd.ExcelWriter, nome: str, dados: list[dict[str, Any]], colunas: list[str]) -> None:
    df = pd.DataFrame(dados, columns=colunas) if dados else pd.DataFrame(columns=colunas)
    df.to_excel(writer, sheet_name=nome, index=False)


def exportar_lista_anual_xlsx(
    caminho: Path,
    prestacao: dict[str, Any],
    informacoes: list[dict[str, str]],
    resumo_mensal: list[dict[str, Any]],
    movimentacoes: list[dict[str, Any]],
    doacoes: list[dict[str, Any]],
    pessoas_sem_cpf: list[dict[str, Any]],
    entradas_nao_pix: list[dict[str, Any]],
    pix_sem_par: list[dict[str, Any]],
    fora_cadastro: pd.DataFrame,
) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(caminho, engine="openpyxl") as writer:
        pd.DataFrame(informacoes).to_excel(writer, sheet_name="informacoes_uteis", index=False)
        _escrever_aba(writer, "resumo_mensal", resumo_mensal, COLUNAS_RESUMO_MENSAL)
        _escrever_aba(writer, "movimentacoes_consolidadas", movimentacoes, COLUNAS_MOVIMENTACOES)
        _escrever_aba(writer, "doacoes_conciliadas", doacoes, COLUNAS_DOACOES)
        _escrever_aba(writer, "pessoas_sem_cpf", pessoas_sem_cpf, COLUNAS_PESSOAS_SEM_CPF)
        _escrever_aba(writer, "entradas_nao_pix", entradas_nao_pix, COLUNAS_ENTRADAS_NAO_PIX)
        _escrever_aba(writer, "pix_sem_par", pix_sem_par, COLUNAS_PIX_SEM_PAR)
        if fora_cadastro.empty:
            fora_cadastro.to_excel(writer, sheet_name="fora_cadastro", index=False)
        else:
            fora_cadastro.to_excel(writer, sheet_name="fora_cadastro", index=False)


def gerar_lista_anual(
    raiz: Path,
    prestacao: dict[str, Any],
    *,
    excel: bool = True,
) -> dict[str, Any]:
    raiz = raiz.resolve()
    revisao_db = raiz / "scripts" / "revisao_db"
    if revisao_db.is_dir():
        import sys

        if str(revisao_db) not in sys.path:
            sys.path.insert(0, str(revisao_db))
        from db import default_db_path

        if default_db_path(raiz).is_file():
            try:
                from lista_anual import gerar_lista_anual_db

                return gerar_lista_anual_db(raiz, prestacao, excel=excel)
            except SystemExit:
                raise

    uf = prestacao["estado_uf"]
    ano = int(prestacao["ano"])
    estado = nome_estado(uf)
    pasta_ano = pasta_ano_prestacao(raiz, prestacao)

    resumo_mensal = montar_resumo_mensal(pasta_ano)
    if not resumo_mensal:
        return {
            "erro": "Nenhum mês processado encontrado",
            "pasta_ano": str(pasta_ano),
        }

    pendencias, meses_incluidos = coletar_pendencias_ano(pasta_ano)
    sucesso_df = coletar_sucesso_ano(pasta_ano)
    mov_df = coletar_movimentacoes_ano(pasta_ano, ano)

    sem_cpf = pendencias[pendencias["categoria"].map(_categoria_sem_cpf)] if not pendencias.empty else pd.DataFrame()
    nao_pix = pendencias[pendencias["categoria"].map(_categoria_nao_pix)] if not pendencias.empty else pd.DataFrame()
    sem_par = pendencias[pendencias["categoria"].map(_categoria_pix_sem_par)] if not pendencias.empty else pd.DataFrame()

    pessoas = agregar_pessoas_sem_cpf(sem_cpf)
    entradas = montar_entradas_nao_pix(nao_pix)
    pix_pend = montar_pix_sem_par(sem_par)
    movimentacoes = montar_movimentacoes_consolidadas(mov_df)
    doacoes = montar_doacoes_conciliadas(sucesso_df)
    fora_df = _ler_fora_cadastro(pasta_ano)
    fora_resumo = _ler_fora_cadastro_resumo(pasta_ano)

    contagens = {
        "total_pessoas_sem_cpf": len(pessoas),
        "transacoes_sem_cpf": sum(int(p.get("qtd_transacoes", 0)) for p in pessoas),
        "total_entradas_nao_pix": len(entradas),
        "total_pix_sem_par": len(pix_pend),
        "total_movimentacoes": len(movimentacoes),
        "total_doacoes_conciliadas": len(doacoes),
        "total_fora_cadastro": fora_resumo.get("total_fora", len(fora_df)),
        "fora_cadastro_certeza": fora_resumo.get("fora_cadastro_certeza", 0),
        "precisam_revisar": fora_resumo.get("precisam_revisar", 0),
    }
    informacoes = montar_informacoes_uteis(prestacao, resumo_mensal, contagens)

    caminho_xlsx = pasta_ano / ARQUIVO_LISTA_ANUAL
    exportar_lista_anual_xlsx(
        caminho_xlsx,
        prestacao,
        informacoes,
        resumo_mensal,
        movimentacoes,
        doacoes,
        pessoas,
        entradas,
        pix_pend,
        fora_df,
    )

    resumo = {
        "estado": estado,
        "estado_uf": uf,
        "ano": ano,
        "meses_incluidos": meses_incluidos or [r["mes"] for r in resumo_mensal],
        **contagens,
        "lista_anual_xlsx": str(caminho_xlsx.relative_to(raiz)),
        "abas": [
            "informacoes_uteis",
            "resumo_mensal",
            "movimentacoes_consolidadas",
            "doacoes_conciliadas",
            "pessoas_sem_cpf",
            "entradas_nao_pix",
            "pix_sem_par",
            "fora_cadastro",
        ],
    }
    (pasta_ano / "lista_anual_resumo.json").write_text(
        json.dumps(resumo, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return resumo
