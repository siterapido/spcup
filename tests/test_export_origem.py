"""Tests for Origem de Recursos XML export."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from spc_up.models.entities import (
    ContaBancaria,
    DiretorioEstadual,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
    PessoaFisica,
)
from spc_up.services.export.origem import build_origem_xml
from spc_up.spca.validate import schema_path, validate_xml

ORIGEM_SCHEMA = schema_path("origem")
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


def _seed_origem_movimentacao(session: Session, diretorio: DiretorioEstadual) -> Movimentacao:
    pessoa = PessoaFisica(cpf="12345678909", nome="Joao Silva")
    session.add(pessoa)
    session.flush()

    conta = ContaBancaria(
        diretorio_estadual_id=diretorio.id,
        agencia="1234",
        conta="56789",
        dv="0",
    )
    session.add(conta)
    session.flush()

    movimentacao = Movimentacao(
        uf="SP",
        exercicio=2025,
        direcao=MovimentacaoDirecao.ENTRADA.value,
        valor=Decimal("500.00"),
        data_movimento=date(2025, 4, 10),
        descricao_raw="Doacao PF via PIX",
        nr_extrato_bancario="EXT001",
        hash_movimento="origemhash001",
        status=MovimentacaoStatus.CONFIRMADO.value,
        pessoa_fisica_id=pessoa.id,
        conta_bancaria_id=conta.id,
    )
    session.add(movimentacao)
    session.flush()

    session.add(
        MovimentacaoSpca(
            movimentacao_id=movimentacao.id,
            fonte_recurso="OR",
            natureza_recurso="0",
            tipo_origem_recurso="PF",
            classificacao_receita="314",
            especie_recurso="PIX",
        )
    )
    session.commit()
    session.refresh(movimentacao)
    return movimentacao


@pytest.mark.skipif(
    not ORIGEM_SCHEMA.is_file(),
    reason="origemRecurso.xsd not installed",
)
def test_build_origem_xml_pf_pix(session: Session, diretorio_sp: DiretorioEstadual):
    _seed_origem_movimentacao(session, diretorio_sp)

    output_path = build_origem_xml(session, uf="SP", exercicio=2025, cnpj=CNPJ_PRESTADOR)

    assert output_path.is_file()
    xml_text = output_path.read_text(encoding="utf-8")
    assert "transferenciaEletronicaPIX" in xml_text
    assert "12345678909" in xml_text
    assert "314" in xml_text

    errors = validate_xml(output_path, schema_name="origem")
    assert errors == []
