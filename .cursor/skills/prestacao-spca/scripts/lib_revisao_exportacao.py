#!/usr/bin/env python3
"""Revisão mensal antes da exportação XML origemRecurso (SPCA/TSE)."""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from lib_diretorios import (
    atualizar_banco_de_pdfs,
    resolver_diretorio,
    validar_diretorio_para_export,
)
from lib_paths import carregar_prestacao, raiz_projeto, arquivo_mes, resolver_arquivo_mensal, pasta_ano_prestacao

# Decorator de backup automático (padrão aplicado em processar_mes.py e
# lib_atualizar_cadastro_bb.py). Usado em salvar_revisao() para regravação
# segura do xlsx de revisão mensal.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from with_backup import with_backup  # noqa: E402

ARQUIVO_REVISAO = "Revisao_Exportacao_SPCA.xlsx"
ABA_PRONTAS = "prontas_exportar"
ABA_BLOQUEADAS = "bloqueadas"
ABA_RESUMO = "resumo"

FONTE_RECURSO = "OR"
NATUREZA_RECURSO = "0"
CLASSIFICACAO_RECEITA = 320

COLS_PRONTAS = [
    "data",
    "valor",
    "documento",
    "nr_extrato_bancario",
    "historico",
    "nome_doador",
    "cpf",
    "cnpj",
    "tipo_pessoa",
    "fonte_recurso",
    "natureza_recurso",
    "classificacao_receita",
    "nr_banco",
    "agencia",
    "dv_agencia",
    "conta",
    "dv_conta",
    "cnpj_prestador",
    "nome_diretorio",
    "aprovado",
]

COLS_BLOQUEADAS = [
    "data",
    "valor",
    "documento",
    "historico",
    "nome_pix",
    "cpf_extrato",
    "categoria",
    "motivo",
    "ignorar_exportacao",
]


def caminho_revisao(output_dir: Path, mes_slug: str) -> Path:
    return output_dir / arquivo_mes(mes_slug, ARQUIVO_REVISAO)


def only_digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _parse_valor_chave(valor: Any) -> str:
    texto = str(valor or "").strip()
    if not texto or texto.lower() == "nan":
        return ""
    if "," in texto and "." not in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return f"{float(texto):.2f}"
    except ValueError:
        return texto


def chave_linha(
    data: Any,
    valor: Any,
    documento: Any,
    cpf_cnpj: Any = "",
) -> str:
    doc = only_digits(documento) or str(documento or "").strip()
    cpf = only_digits(cpf_cnpj)
    val = _parse_valor_chave(valor)
    return f"{str(data or '').strip()}|{val}|{doc}|{cpf}"


def _ler_excel_se_existir(path: Path, aba: str) -> pd.DataFrame:
    if not path.is_file():
        return pd.DataFrame()
    try:
        return pd.read_excel(path, sheet_name=aba, dtype=str)
    except ValueError:
        return pd.DataFrame()


def _montar_prontas_de_sucesso(sucesso: pd.DataFrame, diretorio: dict[str, Any]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for _, row in sucesso.iterrows():
        cpf = str(row.get("CPF Válido") or "").strip()
        cnpj = str(row.get("CNPJ") or "").strip()
        documento = str(row.get("Documento") or "").strip()
        rows.append(
            {
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": documento,
                "nr_extrato_bancario": documento,
                "historico": row.get("Histórico", ""),
                "nome_doador": row.get("Nome do Doador", ""),
                "cpf": cpf,
                "cnpj": cnpj,
                "tipo_pessoa": row.get("Tipo de Pessoa", ""),
                "fonte_recurso": FONTE_RECURSO,
                "natureza_recurso": NATUREZA_RECURSO,
                "classificacao_receita": str(CLASSIFICACAO_RECEITA),
                "nr_banco": diretorio.get("nr_banco", ""),
                "agencia": diretorio.get("agencia", ""),
                "dv_agencia": diretorio.get("dv_agencia", ""),
                "conta": diretorio.get("conta", ""),
                "dv_conta": diretorio.get("dv_conta", ""),
                "cnpj_prestador": diretorio.get("cnpj_prestador", ""),
                "nome_diretorio": diretorio.get("nome_diretorio", ""),
                "aprovado": "",
            }
        )
    return pd.DataFrame(rows, columns=COLS_PRONTAS)


def _montar_bloqueadas_de_pendencias(pendencias: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for _, row in pendencias.iterrows():
        cpf_ext = str(row.get("CPF_extrato") or row.get("CPF Válido") or "").strip()
        rows.append(
            {
                "data": row.get("Data", ""),
                "valor": row.get("Valor", ""),
                "documento": row.get("Documento", ""),
                "historico": row.get("Histórico", ""),
                "nome_pix": row.get("Nome do Doador (PIX)", row.get("Nome_PIX_original", "")),
                "cpf_extrato": cpf_ext,
                "categoria": row.get("categoria", ""),
                "motivo": row.get("motivo", ""),
                "ignorar_exportacao": "",
            }
        )
    return pd.DataFrame(rows, columns=COLS_BLOQUEADAS)


def _merge_prontas(novas: pd.DataFrame, anteriores: pd.DataFrame) -> pd.DataFrame:
    if novas.empty:
        return pd.DataFrame(columns=COLS_PRONTAS)
    ant_map: dict[str, str] = {}
    if not anteriores.empty:
        for _, row in anteriores.iterrows():
            k = chave_linha(
                row.get("data"),
                row.get("valor"),
                row.get("documento"),
                row.get("cpf") or row.get("cnpj"),
            )
            ant_map[k] = str(row.get("aprovado") or "").strip().upper()

    out_rows: list[dict[str, Any]] = []
    for _, row in novas.iterrows():
        item = row.to_dict()
        k = chave_linha(item.get("data"), item.get("valor"), item.get("documento"), item.get("cpf") or item.get("cnpj"))
        prev = ant_map.get(k, "")
        item["aprovado"] = prev if prev == "S" else ""
        out_rows.append(item)
    return pd.DataFrame(out_rows, columns=COLS_PRONTAS)


def _merge_bloqueadas(novas: pd.DataFrame, anteriores: pd.DataFrame) -> pd.DataFrame:
    if novas.empty:
        return pd.DataFrame(columns=COLS_BLOQUEADAS)
    ant_map: dict[str, str] = {}
    if not anteriores.empty:
        for _, row in anteriores.iterrows():
            k = chave_linha(row.get("data"), row.get("valor"), row.get("documento"), row.get("cpf_extrato"))
            ant_map[k] = str(row.get("ignorar_exportacao") or "").strip().upper()

    out_rows: list[dict[str, Any]] = []
    for _, row in novas.iterrows():
        item = row.to_dict()
        k = chave_linha(item.get("data"), item.get("valor"), item.get("documento"), item.get("cpf_extrato"))
        prev = ant_map.get(k, "")
        item["ignorar_exportacao"] = prev if prev == "S" else ""
        out_rows.append(item)
    return pd.DataFrame(out_rows, columns=COLS_BLOQUEADAS)


def mes_elegivel_xml(prontas: pd.DataFrame, bloqueadas: pd.DataFrame) -> tuple[bool, list[str]]:
    motivos: list[str] = []
    if prontas.empty:
        motivos.append("Nenhuma linha em prontas_exportar")
        return False, motivos

    pendentes_aprovacao = prontas[
        prontas["aprovado"].astype(str).str.upper().str.strip() != "S"
    ]
    if not pendentes_aprovacao.empty:
        motivos.append(
            f"{len(pendentes_aprovacao)} linha(s) em prontas_exportar sem aprovado=S"
        )

    if not bloqueadas.empty:
        bloq_pend = bloqueadas[
            bloqueadas["ignorar_exportacao"].astype(str).str.upper().str.strip() != "S"
        ]
        if not bloq_pend.empty:
            motivos.append(
                f"{len(bloq_pend)} linha(s) em bloqueadas sem ignorar_exportacao=S"
            )

    return len(motivos) == 0, motivos


def montar_resumo(
    *,
    meta: dict[str, Any],
    diretorio: dict[str, Any],
    prontas: pd.DataFrame,
    bloqueadas: pd.DataFrame,
    erros_diretorio: list[str],
) -> pd.DataFrame:
    elegivel, motivos = mes_elegivel_xml(prontas, bloqueadas)
    linhas = [
        {"campo": "Estado", "valor": meta.get("estado", "")},
        {"campo": "UF", "valor": meta.get("estado_uf", "")},
        {"campo": "Ano", "valor": str(meta.get("ano", ""))},
        {"campo": "Mês", "valor": meta.get("mes_nome", "")},
        {"campo": "Diretório", "valor": diretorio.get("nome_diretorio", "")},
        {"campo": "CNPJ prestador", "valor": diretorio.get("cnpj_prestador", "")},
        {"campo": "fonteRecurso (fixo)", "valor": FONTE_RECURSO},
        {"campo": "naturezaRecurso (fixo)", "valor": NATUREZA_RECURSO},
        {"campo": "classificacaoReceita (fixo)", "valor": str(CLASSIFICACAO_RECEITA)},
        {"campo": "Prontas exportar (qtd)", "valor": str(len(prontas))},
        {"campo": "Bloqueadas (qtd)", "valor": str(len(bloqueadas))},
        {"campo": "Prontas aprovadas (S)", "valor": str((prontas["aprovado"].astype(str).str.upper() == "S").sum() if not prontas.empty else 0)},
        {"campo": "Bloqueadas ignoradas (S)", "valor": str((bloqueadas["ignorar_exportacao"].astype(str).str.upper() == "S").sum() if not bloqueadas.empty else 0)},
        {"campo": "Mês elegível para XML", "valor": "SIM" if elegivel else "NAO"},
        {"campo": "Motivos bloqueio XML", "valor": "; ".join(motivos) if motivos else ""},
        {"campo": "Erros cadastro diretório", "valor": "; ".join(erros_diretorio) if erros_diretorio else ""},
        {"campo": "Gerado em", "valor": datetime.now().strftime("%Y-%m-%d %H:%M:%S")},
        {"campo": "Instruções", "valor": "Marque aprovado=S nas prontas; ignorar_exportacao=S nas bloqueadas conferidas; depois gerar-xml"},
    ]
    return pd.DataFrame(linhas)


def _escrever_xlsx(
    target: Path,
    prontas: pd.DataFrame,
    bloqueadas: pd.DataFrame,
    resumo: pd.DataFrame,
) -> None:
    """Escreve planilha de revisão mensal no destino. Mutante: callers devem
    proteger com @with_backup(target) para regravação segura."""
    with pd.ExcelWriter(target, engine="openpyxl") as writer:
        prontas.to_excel(writer, sheet_name=ABA_PRONTAS, index=False)
        bloqueadas.to_excel(writer, sheet_name=ABA_BLOQUEADAS, index=False)
        resumo.to_excel(writer, sheet_name=ABA_RESUMO, index=False)


def salvar_revisao(
    output_dir: Path,
    prontas: pd.DataFrame,
    bloqueadas: pd.DataFrame,
    resumo: pd.DataFrame,
    *,
    mes_slug: str,
) -> Path:
    path = caminho_revisao(output_dir, mes_slug)
    output_dir.mkdir(parents=True, exist_ok=True)

    if path.is_file():
        # Regravação: o decorator @with_backup faz backup binário pré-mutação
        # e restaura o estado anterior em caso de exceção durante a escrita.
        @with_backup(path)
        def _salvar_com_backup(target: Path) -> None:
            _escrever_xlsx(target, prontas, bloqueadas, resumo)

        _salvar_com_backup()
    else:
        # 1ª escrita: não há o que copiar como backup — grava direto.
        _escrever_xlsx(path, prontas, bloqueadas, resumo)
    return path


def preparar_revisao_mes(
    raiz: Path,
    paths: dict[str, Any],
    stats: dict[str, Any],
    *,
    pdfs: list[Path] | None = None,
    ant_prontas: pd.DataFrame | None = None,
    ant_bloq: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Monta prontas/bloqueadas da conciliação; preserva aprovações anteriores se fornecidas."""
    output_dir = Path(paths["output_dir"])
    mes_slug = str(paths["mes_slug"])
    estado_uf = str(paths["estado_uf"])
    ano = int(paths["ano"])

    lista_pdfs = list(pdfs or [])
    if not lista_pdfs:
        lista_pdfs = list(paths.get("pdfs_total") or []) + list(paths.get("pdfs_pix") or [])

    meta_banco = atualizar_banco_de_pdfs(raiz, estado_uf=estado_uf, ano=ano, pdfs=lista_pdfs)
    conta_extrato = meta_banco.get("conta_extrato") or {}

    prestacao = carregar_prestacao(raiz) or {}
    erros_resolver: list[str] = []
    try:
        diretorio = resolver_diretorio(
            raiz,
            estado_uf=estado_uf,
            ano=ano,
            cnpj_prestador=prestacao.get("cnpj_prestador"),
            conta_extrato=conta_extrato if conta_extrato else None,
        )
    except ValueError as exc:
        erros_resolver.append(str(exc))
        from lib_diretorios import filtrar_diretorios, carregar_diretorios

        sub = filtrar_diretorios(carregar_diretorios(raiz), estado_uf, ano)
        diretorio = sub.iloc[0].to_dict() if not sub.empty else {}
    erros_dir = erros_resolver + validar_diretorio_para_export(diretorio)

    path_sucesso = Path(stats["path_sucesso"])
    path_pendencias = Path(stats["path_pendencias"])
    sucesso = pd.read_excel(path_sucesso, dtype=str) if path_sucesso.is_file() else pd.DataFrame()
    pendencias = pd.read_excel(path_pendencias, dtype=str) if path_pendencias.is_file() else pd.DataFrame()

    novas_prontas = _montar_prontas_de_sucesso(sucesso, diretorio)
    novas_bloq = _montar_bloqueadas_de_pendencias(pendencias)

    if ant_prontas is None or ant_bloq is None:
        revisao_path = caminho_revisao(output_dir, mes_slug)
        if not revisao_path.is_file():
            prestacao = carregar_prestacao(raiz) or {}
            pasta_ano = pasta_ano_prestacao(raiz, prestacao) if prestacao else None
            if pasta_ano:
                legado = resolver_arquivo_mensal(pasta_ano, mes_slug, ARQUIVO_REVISAO)
                if legado and legado != revisao_path:
                    revisao_path = legado
        if ant_prontas is None:
            ant_prontas = _ler_excel_se_existir(revisao_path, ABA_PRONTAS)
        if ant_bloq is None:
            ant_bloq = _ler_excel_se_existir(revisao_path, ABA_BLOQUEADAS)

    prontas = _merge_prontas(novas_prontas, ant_prontas if ant_prontas is not None else pd.DataFrame())
    bloqueadas = _merge_bloqueadas(novas_bloq, ant_bloq if ant_bloq is not None else pd.DataFrame())

    meta = {
        "estado": paths.get("estado"),
        "estado_uf": estado_uf,
        "ano": ano,
        "mes_nome": paths.get("mes_nome"),
        "mes_slug": paths.get("mes_slug"),
    }
    resumo = montar_resumo(
        meta=meta,
        diretorio=diretorio,
        prontas=prontas,
        bloqueadas=bloqueadas,
        erros_diretorio=erros_dir,
    )
    elegivel, motivos = mes_elegivel_xml(prontas, bloqueadas)

    return {
        "prontas": prontas,
        "bloqueadas": bloqueadas,
        "resumo": resumo,
        "elegivel_xml": elegivel,
        "motivos_xml": motivos,
        "erros_diretorio": erros_dir,
        "banco_auto": meta_banco,
        "diretorio": {
            "nome_diretorio": diretorio.get("nome_diretorio", ""),
            "cnpj_prestador": str(diretorio.get("cnpj_prestador") or "").strip(),
        },
        "meta": meta,
        "mes_slug": mes_slug,
        "output_dir": output_dir,
    }


def gerar_revisao_mes(
    raiz: Path,
    paths: dict[str, Any],
    stats: dict[str, Any],
    *,
    pdfs: list[Path] | None = None,
) -> dict[str, Any]:
    """Gera ou atualiza Revisao_Exportacao_SPCA.xlsx na pasta mensal."""
    prep = preparar_revisao_mes(raiz, paths, stats, pdfs=pdfs)
    path = salvar_revisao(
        prep["output_dir"],
        prep["prontas"],
        prep["bloqueadas"],
        prep["resumo"],
        mes_slug=str(prep["mes_slug"]),
    )
    return {
        "path_revisao": str(path),
        "elegivel_xml": prep["elegivel_xml"],
        "motivos_xml": prep["motivos_xml"],
        "erros_diretorio": prep["erros_diretorio"],
        "banco_auto": prep["banco_auto"],
        "diretorio": prep["diretorio"],
    }


def carregar_revisao_mes(output_dir: Path, mes_slug: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    path = caminho_revisao(output_dir, mes_slug)
    if not path.is_file():
        raise FileNotFoundError(f"Revisão ausente: {path}")
    prontas = pd.read_excel(path, sheet_name=ABA_PRONTAS, dtype=str)
    bloqueadas = pd.read_excel(path, sheet_name=ABA_BLOQUEADAS, dtype=str)
    resumo = pd.read_excel(path, sheet_name=ABA_RESUMO, dtype=str)
    return prontas, bloqueadas, resumo
