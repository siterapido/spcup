"""Smoke tests for the Typer CLI."""

from __future__ import annotations

from pathlib import Path

import pytest
from typer.testing import CliRunner

from spc_up.cli.main import app
from spc_up.spca.validate import schema_path, validate_xml

runner = CliRunner()
ORIGEM_SCHEMA = schema_path("origem")


def test_cli_help():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "ingest" in result.stdout
    assert "pendencias" in result.stdout
    assert "confirm" in result.stdout
    assert "export" in result.stdout
    assert "validate-xsd" in result.stdout


@pytest.mark.skipif(
    not ORIGEM_SCHEMA.is_file(),
    reason="origemRecurso.xsd not installed",
)
def test_validate_xsd_command_valid(tmp_path: Path):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
      <CABECALHO><nrCnpjPrestador>23738595000182</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
      <CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO>
    </spcaImportacaoArquivo>"""
    xml_path = tmp_path / "origem.xml"
    xml_path.write_text(xml, encoding="utf-8")

    result = runner.invoke(
        app,
        ["validate-xsd", "--file", str(xml_path), "--schema", "origem"],
    )
    assert result.exit_code == 0
    assert "OK" in result.stdout


def test_validate_xsd_command_invalid(tmp_path: Path):
    xml_path = tmp_path / "bad.xml"
    xml_path.write_text("<root/>", encoding="utf-8")

    result = runner.invoke(
        app,
        ["validate-xsd", "--file", str(xml_path), "--schema", "origem"],
    )
    assert result.exit_code != 0
