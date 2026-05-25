import pytest

from spc_up.spca.validate import schema_path, validate_xml

ORIGEM_SCHEMA = schema_path("origem")
APLICACAO_SCHEMA = schema_path("aplicacao")
DOACAO_SCHEMA = schema_path("doacao")


@pytest.mark.skipif(
    not ORIGEM_SCHEMA.is_file(),
    reason="origemRecurso.xsd not installed",
)
def test_validate_minimal_origem_xml(tmp_path):
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <spcaImportacaoArquivo xmlns="http://www.tse.jus.br/2012/XMLSchema/origemRecurso.xsd">
      <CABECALHO><nrCnpjPrestador>23738595000182</nrCnpjPrestador><anoExercicio>2025</anoExercicio></CABECALHO>
      <CORPO><origens><totalOrigem>0</totalOrigem></origens></CORPO>
    </spcaImportacaoArquivo>"""
    p = tmp_path / "t.xml"
    p.write_text(xml, encoding="utf-8")
    errors = validate_xml(p, schema_name="origem")
    assert errors == []


@pytest.mark.skipif(
    not APLICACAO_SCHEMA.is_file(),
    reason="aplicacaoRecurso.xsd not installed",
)
def test_aplicacao_schema_available():
    assert APLICACAO_SCHEMA.is_file()


@pytest.mark.skipif(
    not DOACAO_SCHEMA.is_file(),
    reason="doacaoFinanceira.xsd not installed",
)
def test_doacao_schema_available():
    assert DOACAO_SCHEMA.is_file()
