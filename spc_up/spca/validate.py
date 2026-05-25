"""Validate SPCA XML files against bundled XSD schemas."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from lxml import etree

_SCHEMA_DIR = Path(__file__).parent / "schemas"

_SCHEMA_FILES: dict[str, str] = {
    "origem": "origemRecurso.xsd",
    "aplicacao": "aplicacaoRecurso.xsd",
    "doacao": "doacaoFinanceira.xsd",
}

SchemaName = Literal["origem", "aplicacao", "doacao"]


def schema_path(schema_name: SchemaName) -> Path:
    filename = _SCHEMA_FILES[schema_name]
    return _SCHEMA_DIR / filename


def validate_xml(path: Path | str, *, schema_name: SchemaName) -> list[str]:
    """Validate an XML file against the named SPCA schema.

    Returns an empty list when valid, otherwise a list of error messages.
    """
    xsd_path = schema_path(schema_name)
    if not xsd_path.is_file():
        raise FileNotFoundError(f"Schema not found: {xsd_path}")

    schema = etree.XMLSchema(etree.parse(str(xsd_path)))
    xml_doc = etree.parse(str(path))

    if schema.validate(xml_doc):
        return []

    return [str(entry) for entry in schema.error_log]
