#!/usr/bin/env python3
"""Geração XML origemRecurso (SPCA/TSE) a partir da revisão mensal."""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.dom import minidom
from xml.etree import ElementTree as ET

import pandas as pd

from lib_diretorios import normalizar_cnpj, only_digits, resolver_diretorio, validar_diretorio_para_export
from lib_paths import (
    MES_NUMERO,
    carregar_prestacao,
    dir_saida_mensal,
    escopo_prestacao,
    nome_estado,
    normalizar_uf,
    raiz_projeto,
)
from lib_revisao_exportacao import (
    ABA_PRONTAS,
    CLASSIFICACAO_RECEITA,
    FONTE_RECURSO,
    NATUREZA_RECURSO,
    caminho_revisao,
    mes_elegivel_xml,
)

# Decorator de backup automático (mesmo padrão de lib_revisao_exportacao.py).
# Usado em gerar_xml_mes() para regravação segura do XML de origemRecurso.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from with_backup import with_backup  # noqa: E402

NS = "http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd"
ET.register_namespace("", NS)


def _q(tag: str) -> str:
    return f"{{{NS}}}{tag}"


def _data_iso(data_br: Any) -> str:
    texto = str(data_br or "").strip()
    if not texto or texto.lower() == "nan":
        return ""
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(texto[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def _moeda(valor: Any) -> str:
    if valor is None or str(valor).strip().lower() in ("", "nan"):
        return ""
    texto = str(valor).strip()
    if "," in texto:
        texto = texto.replace(".", "").replace(",", ".")
    try:
        return f"{float(texto):.2f}"
    except ValueError:
        return ""


def _sub(parent: ET.Element, tag: str, text: str | int) -> ET.Element:
    el = ET.SubElement(parent, _q(tag))
    el.text = str(text)
    return el


def _montar_pessoa_fisica(parent: ET.Element, cpf: str, nome: str) -> None:
    pf = ET.SubElement(parent, _q("pessoaFisica"))
    _sub(pf, "tipo", "PF")
    _sub(pf, "nrCpf", only_digits(cpf))
    _sub(pf, "nmPessoa", str(nome or "").strip()[:150])


def _montar_pessoa_juridica(parent: ET.Element, cnpj: str, nome: str) -> None:
    pj = ET.SubElement(parent, _q("pessoaJuridica"))
    _sub(pj, "tipo", "PJ")
    _sub(pj, "nrCnpj", normalizar_cnpj(cnpj))
    _sub(pj, "nmPessoa", str(nome or "").strip()[:150])


def _montar_pix(parent: ET.Element, row: pd.Series) -> None:
    pix = ET.SubElement(parent, _q("transferenciaEletronicaPIX"))
    _sub(pix, "especieRecurso", "PIX")
    nr_ext = str(row.get("nr_extrato_bancario") or row.get("documento") or "").strip()
    _sub(pix, "nrExtratoBancario", nr_ext[:50])
    conta_dest = ET.SubElement(pix, _q("contaBancariaDestino"))
    banco = ET.SubElement(conta_dest, _q("bancoDestino"))
    _sub(banco, "nrBancoDestino", str(row.get("nr_banco") or "").strip())
    _sub(banco, "agenciaDestino", str(row.get("agencia") or "").strip())
    dv_ag = str(row.get("dv_agencia") or "").strip()
    if dv_ag:
        _sub(banco, "dvAgenciaDestino", dv_ag)
    _sub(banco, "contaCorrente", str(row.get("conta") or "").strip())
    _sub(banco, "dvContaCorrente", str(row.get("dv_conta") or "").strip())


def _celula_limpa(value: Any) -> str:
    texto = str(value or "").strip()
    if texto.lower() in ("", "nan", "none"):
        return ""
    return texto


def _montar_origem(row: pd.Series) -> ET.Element | None:
    dt = _data_iso(row.get("data"))
    vr = _moeda(row.get("valor"))
    if not dt or not vr or float(vr) <= 0:
        return None

    origem = ET.Element(_q("origem"))
    _sub(origem, "dtEntrada", dt)
    _sub(origem, "vrOrigem", vr)
    _sub(origem, "fonteRecurso", FONTE_RECURSO)
    _sub(origem, "naturezaRecurso", NATUREZA_RECURSO)

    origem_recurso = ET.SubElement(origem, _q("origemRecurso"))
    cnpj = _celula_limpa(row.get("cnpj"))
    cpf = _celula_limpa(row.get("cpf"))
    nome = _celula_limpa(row.get("nome_doador"))
    tipo = _celula_limpa(row.get("tipo_pessoa")).upper()

    if cnpj or "JUR" in tipo or "PJ" in tipo:
        if not cnpj:
            return None
        _montar_pessoa_juridica(origem_recurso, cnpj, nome)
    else:
        if not cpf or not nome:
            return None
        _montar_pessoa_fisica(origem_recurso, cpf, nome)

    _sub(origem, "classificacaoReceita", str(CLASSIFICACAO_RECEITA))
    especie = ET.SubElement(origem, _q("especieRecurso"))
    _montar_pix(especie, row)
    return origem


def montar_xml_origem_recurso(
    *,
    cnpj_prestador: str,
    ano: int,
    linhas: pd.DataFrame,
) -> ET.Element:
    root = ET.Element(_q("spcaImportacaoArquivo"))

    cab = ET.SubElement(root, _q("CABECALHO"))
    _sub(cab, "nrCnpjPrestador", normalizar_cnpj(cnpj_prestador))
    _sub(cab, "anoExercicio", int(ano))

    corpo = ET.SubElement(root, _q("CORPO"))
    origens = ET.SubElement(corpo, _q("origens"))

    elementos: list[ET.Element] = []
    for _, row in linhas.iterrows():
        if str(row.get("aprovado") or "").strip().upper() != "S":
            continue
        el = _montar_origem(row)
        if el is not None:
            elementos.append(el)

    _sub(origens, "totalOrigem", len(elementos))
    for el in elementos:
        origens.append(el)

    return root


def serializar_xml_iso8859(element: ET.Element) -> bytes:
    rough = ET.tostring(element, encoding="unicode")
    parsed = minidom.parseString(rough)
    xml_decl = b'<?xml version="1.0" encoding="ISO-8859-1"?>\n'
    body = parsed.toprettyxml(indent="\t", encoding="ISO-8859-1")
    # minidom repete declaração — manter só uma
    if body.startswith(b"<?xml"):
        body = body.split(b"\n", 1)[1]
    return xml_decl + body.lstrip()


def _escrever_xml(target: Path, xml_bytes: bytes) -> None:
    """Escreve bytes do XML origemRecurso no destino. Mutante: callers devem
    proteger com @with_backup(target) para regravação segura."""
    target.write_bytes(xml_bytes)


def pasta_exportacao(raiz: Path, estado: str, ano: int, escopo: str | None = None) -> Path:
    base = raiz / estado / str(ano)
    if escopo:
        base = base / escopo
    dest = base / "exportacao"
    dest.mkdir(parents=True, exist_ok=True)
    return dest


def _carregar_revisao_mes(
    raiz: Path,
    *,
    estado: str,
    ano: int,
    mes_slug: str,
    output_mes_dir: Path,
    escopo: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, str]:
    """SQLite primeiro; fallback Excel legado."""
    revisao_db = raiz.resolve() / "scripts" / "revisao_db"
    if revisao_db.is_dir():
        if str(revisao_db) not in sys.path:
            sys.path.insert(0, str(revisao_db))
        try:
            from sync import default_db_path, ler_revisao_mes_db

            pair = ler_revisao_mes_db(
                raiz, estado, ano, mes_slug, escopo, default_db_path(raiz)
            )
            if pair:
                return pair[0], pair[1], "sqlite"
        except Exception:
            pass

    revisao_path = caminho_revisao(output_mes_dir, mes_slug)
    if not revisao_path.is_file():
        raise FileNotFoundError(f"Revisão ausente no DB e sem Excel: {revisao_path}")
    prontas = pd.read_excel(revisao_path, sheet_name=ABA_PRONTAS, dtype=str)
    bloqueadas = pd.read_excel(revisao_path, sheet_name="bloqueadas", dtype=str)
    return prontas, bloqueadas, "excel"


def _revisao_db_dir(raiz: Path) -> Path | None:
    path = raiz.resolve() / "scripts" / "revisao_db"
    return path if path.is_dir() else None


def _registrar_xml_no_db(
    raiz: Path,
    *,
    estado: str,
    ano: int,
    mes_slug: str,
    escopo: str | None,
    revisao_n: int,
    path: Path,
    origens: int,
) -> None:
    revisao_db = _revisao_db_dir(raiz)
    if not revisao_db:
        return
    if str(revisao_db) not in sys.path:
        sys.path.insert(0, str(revisao_db))
    from db import default_db_path, session
    from sync import mes_id_por_slug, registrar_exportacao_xml

    with session(default_db_path(raiz)) as conn:
        mes_id = mes_id_por_slug(conn, estado, ano, mes_slug, escopo)
        if mes_id is None:
            return
        registrar_exportacao_xml(conn, mes_id, revisao_n, str(path), origens)


def gerar_xml_mes(
    raiz: Path,
    *,
    estado: str,
    estado_uf: str,
    ano: int,
    mes_slug: str,
    output_mes_dir: Path,
    escopo: str | None = None,
) -> dict[str, Any]:
    try:
        prontas, bloqueadas, fonte = _carregar_revisao_mes(
            raiz,
            estado=estado,
            ano=ano,
            mes_slug=mes_slug,
            output_mes_dir=output_mes_dir,
            escopo=escopo,
        )
    except FileNotFoundError as exc:
        return {"mes": mes_slug, "gerado": False, "motivo": str(exc)}

    elegivel, motivos = mes_elegivel_xml(prontas, bloqueadas)
    if not elegivel:
        return {"mes": mes_slug, "gerado": False, "motivo": "; ".join(motivos), "fonte": fonte}

    prestacao = carregar_prestacao(raiz) or {}
    # Passa conta do extrato da 1ª aprovada para desambiguar diretórios
    # (PB tem 4 diretórios e mesmo CNPJ raiz entre estaduais/municipais).
    conta_extrato = None
    if not prontas.empty:
        r0 = prontas.iloc[0]

        def _c(v):
            if v is None:
                return ""
            return str(v).strip()

        conta_extrato = {
            "nr_banco": _c(r0.get("nr_banco")),
            "agencia": _c(r0.get("agencia")),
            "conta": _c(r0.get("conta")),
        }
    diretorio = resolver_diretorio(
        raiz,
        estado_uf=estado_uf,
        ano=ano,
        cnpj_prestador=prestacao.get("cnpj_prestador"),
        conta_extrato=conta_extrato,
    )
    erros = validar_diretorio_para_export(diretorio)
    if erros:
        return {"mes": mes_slug, "gerado": False, "motivo": "; ".join(erros)}

    aprovadas = prontas[prontas["aprovado"].astype(str).str.upper().str.strip() == "S"]
    if aprovadas.empty:
        return {"mes": mes_slug, "gerado": False, "motivo": "Nenhuma linha aprovada"}

    root = montar_xml_origem_recurso(
        cnpj_prestador=str(diretorio.get("cnpj_prestador") or ""),
        ano=ano,
        linhas=aprovadas,
    )
    xml_bytes = serializar_xml_iso8859(root)
    escopo = escopo_prestacao(raiz)
    dest_dir = pasta_exportacao(raiz, estado, ano, escopo)
    prefixo = f"{escopo}-{ano}-{mes_slug}" if escopo else f"{mes_slug}"

    revisao_n: int | None = None
    revisao_db = _revisao_db_dir(raiz)
    if revisao_db:
        if str(revisao_db) not in sys.path:
            sys.path.insert(0, str(revisao_db))
        from db import default_db_path, session
        from sync import mes_id_por_slug, proxima_revisao_n

        with session(default_db_path(raiz)) as conn:
            mes_id = mes_id_por_slug(conn, estado, ano, mes_slug, escopo)
            if mes_id is not None:
                revisao_n = proxima_revisao_n(conn, mes_id)

    if revisao_n is not None:
        destino = dest_dir / f"{prefixo}-r{revisao_n}-origemRecurso.xml"
    else:
        destino = dest_dir / f"{prefixo}-origemRecurso.xml"

    if destino.is_file():
        # Regravação: backup binário do XML anterior + restauração em falha.
        @with_backup(destino)
        def _salvar_xml_com_backup(target: Path) -> None:
            _escrever_xml(target, xml_bytes)

        _salvar_xml_com_backup()
    else:
        # 1ª escrita: grava direto (sem estado anterior a preservar).
        _escrever_xml(destino, xml_bytes)

    if revisao_n is not None:
        _registrar_xml_no_db(
            raiz,
            estado=estado,
            ano=ano,
            mes_slug=mes_slug,
            escopo=escopo,
            revisao_n=revisao_n,
            path=destino,
            origens=int(aprovadas.shape[0]),
        )

    resultado: dict[str, Any] = {
        "mes": mes_slug,
        "gerado": True,
        "path": str(destino),
        "origens": int(aprovadas.shape[0]),
        "fonte": fonte,
    }
    if revisao_n is not None:
        resultado["revisao_n"] = revisao_n
    return resultado


def listar_meses_ordenados(meses: list[str] | None = None) -> list[str]:
    if meses:
        return meses
    return sorted(MES_NUMERO.keys(), key=lambda m: MES_NUMERO[m])


def gerar_xml_lote(
    raiz: Path,
    *,
    estado: str,
    estado_uf: str,
    ano: int,
    meses: list[str] | None = None,
) -> dict[str, Any]:
    raiz = raiz_projeto(raiz)
    escopo = escopo_prestacao(raiz)
    resultados: list[dict[str, Any]] = []
    for mes_slug in listar_meses_ordenados(meses):
        output_dir = dir_saida_mensal(raiz, estado, ano, escopo)
        resultados.append(
            gerar_xml_mes(
                raiz,
                estado=estado,
                estado_uf=estado_uf,
                ano=ano,
                mes_slug=mes_slug,
                output_mes_dir=output_dir,
                escopo=escopo,
            )
        )
    gerados = [r for r in resultados if r.get("gerado")]
    pulados = [r for r in resultados if not r.get("gerado")]
    return {
        "estado": estado,
        "estado_uf": estado_uf,
        "ano": ano,
        "gerados": gerados,
        "pulados": pulados,
        "pasta_exportacao": str(pasta_exportacao(raiz, estado, ano, escopo)),
    }


def resolver_estado_ano(raiz: Path, estado: str | None, ano: int | None) -> tuple[str, str, int]:
    prestacao = carregar_prestacao(raiz)
    if prestacao and not estado:
        return prestacao["estado"], prestacao["estado_uf"], int(prestacao["ano"])
    if not estado or not ano:
        raise SystemExit("Informe --estado e --ano ou configure resultados/prestacao.json")
    uf = normalizar_uf(estado)
    return nome_estado(uf), uf, int(ano)
