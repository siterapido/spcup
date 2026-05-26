"""Tests for Aplicação de Recursos XML export."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from spc_up.models.entities import (
    DiretorioEstadual,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaJuridica,
)
from spc_up.services.export.aplicacao import build_aplicacao_xml
from spc_up.spca.validate import schema_path, validate_xml

APLICACAO_SCHEMA = schema_path("aplicacao")
CNPJ_PRESTADOR = "23738595000182"


@pytest.fixture
def diretorio_sp(session: Session) -> DiretorioEstadual:
    diretorio = DiretorioEstadual(
        uf="SP",
        cnpj_prestador=CNPJ_PRESTADOR,
        nome="Diretorio SP",
    )
    session.add(diretorio)
    session.commit()
    return diretorio


def _seed_aplicacao_movimentacao(session: Session, diretorio: DiretorioEstadual) -> Movimentacao:
    pessoa = PessoaJuridica(cnpj="11222333000181", razao_social="Fornecedor LTDA")
    session.add(pessoa)
    session.flush()

    movimentacao = Movimentacao(
        uf="SP",
        exercicio=2025,
        direcao=MovimentacaoDirecao.SAIDA.value,
        valor=Decimal("250.00"),
        data_movimento=date(2025, 5, 12),
        descricao_raw="Despesa internet campanha",
        hash_movimento="aplichash001",
        status=MovimentacaoStatus.CONFIRMADO.value,
        pessoa_juridica_id=pessoa.id,
    )
    session.add(movimentacao)
    session.flush()

    session.add(
        MovimentacaoSpca(
            movimentacao_id=movimentacao.id,
            cd_descricao_gasto="401",
            tipo_documento="RECIBO",
            nr_documento="REC-2025-001",
            data_emissao_contratacao=date(2025, 5, 12),
            detalhe_situacao=1,
            descricao_resumida="Pagamento paginas internet",
        )
    )
    session.commit()
    session.refresh(movimentacao)
    return movimentacao


@pytest.mark.skipif(
    not APLICACAO_SCHEMA.is_file(),
    reason="aplicacaoRecurso.xsd not installed",
)
def test_build_aplicacao_xml_pj_recibo(session: Session, diretorio_sp: DiretorioEstadual):
    _seed_aplicacao_movimentacao(session, diretorio_sp)

    output_path = build_aplicacao_xml(session, uf="SP", exercicio=2025, cnpj=CNPJ_PRESTADOR)

    assert output_path.is_file()
    xml_text = output_path.read_text(encoding="utf-8")
    assert "importacaoAplicacaoRecurso" in xml_text
    assert "pessoaJuridica" in xml_text
    assert "11222333000181" in xml_text
    assert "<recibo>" in xml_text or "recibo" in xml_text
    assert "401" in xml_text
    assert "situacao1" in xml_text
    assert "Pagamento paginas internet" in xml_text

    errors = validate_xml(output_path, schema_name="aplicacao")
    assert errors == []
