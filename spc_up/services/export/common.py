"""Shared helpers for SPCA XML export builders."""

from __future__ import annotations

from pathlib import Path

from lxml import etree

ORIGEM_NS = "http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd"
APLICACAO_NS = "http://www.tse.jus.br/2012/XMLSchema/aplicacaoRecurso.xsd"
ORIGEM_NSMAP = {None: ORIGEM_NS}
APLICACAO_NSMAP = {None: APLICACAO_NS}
NSMAP = ORIGEM_NSMAP


def make_origem_root() -> etree._Element:
    return etree.Element(f"{{{ORIGEM_NS}}}spcaImportacaoArquivo", nsmap=ORIGEM_NSMAP)


def make_aplicacao_root() -> etree._Element:
    return etree.Element(
        f"{{{APLICACAO_NS}}}importacaoAplicacaoRecurso",
        nsmap=APLICACAO_NSMAP,
    )


def sub(
    parent: etree._Element,
    tag: str,
    text: str | int | None = None,
    *,
    namespace: str = ORIGEM_NS,
) -> etree._Element:
    element = etree.SubElement(parent, f"{{{namespace}}}{tag}")
    if text is not None:
        element.text = str(text)
    return element


def sub_aplicacao(parent: etree._Element, tag: str, text: str | int | None = None) -> etree._Element:
    return sub(parent, tag, text, namespace=APLICACAO_NS)


def build_cabecalho(
    parent: etree._Element,
    *,
    cnpj: str,
    exercicio: int,
    namespace: str = ORIGEM_NS,
) -> None:
    cabecalho = sub(parent, "CABECALHO", namespace=namespace)
    sub(cabecalho, "nrCnpjPrestador", cnpj, namespace=namespace)
    sub(cabecalho, "anoExercicio", exercicio, namespace=namespace)


def format_moeda(value) -> str:
    return f"{value:.2f}"


def write_xml(root: etree._Element, path: Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tree = etree.ElementTree(root)
    tree.write(
        str(path),
        encoding="UTF-8",
        xml_declaration=True,
        pretty_print=True,
    )
    return path
