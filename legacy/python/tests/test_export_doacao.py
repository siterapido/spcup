"""Tests for Doacao Financeira XML export and linking."""

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
from spc_up.services.doacao.link import DOACAO_CODES, ensure_doacao_link
from spc_up.services.export.doacao import build_doacao_xml
from spc_up.spca.validate import schema_path, validate_xml

DOACAO_SCHEMA = schema_path("doacao")
CNPJ_PRESTADOR = "23738595000182"
NR_RECIBO = "12345678"


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


def _seed_doacao_movimentacao(
    session: Session,
    diretorio: DiretorioEstadual,
    *,
    sincronizado_via_link: bool = True,
) -> Movimentacao:
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
        hash_movimento="doacaohash001",
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
            nr_recibo_doacao=NR_RECIBO,
        )
    )
    session.commit()

    if sincronizado_via_link:
        link = ensure_doacao_link(session, movimentacao.id)
        assert link is not None
        assert link.sincronizado is True

    session.refresh(movimentacao)
    return movimentacao


def test_doacao_codes_contains_expected_values():
    assert DOACAO_CODES == frozenset({"314", "315", "397"})


def test_ensure_doacao_link_creates_record(session: Session, diretorio_sp: DiretorioEstadual):
    movimentacao = _seed_doacao_movimentacao(session, diretorio_sp, sincronizado_via_link=False)

    link = ensure_doacao_link(session, movimentacao.id)

    assert link is not None
    assert link.movimentacao_origem_id == movimentacao.id
    assert link.sincronizado is True


def test_ensure_doacao_link_skips_non_doacao_classificacao(session: Session):
    movimentacao = Movimentacao(
        uf="SP",
        exercicio=2025,
        direcao=MovimentacaoDirecao.ENTRADA.value,
        valor=Decimal("100.00"),
        data_movimento=date(2025, 4, 10),
        descricao_raw="Outra receita",
        hash_movimento="nodoacaohash001",
        status=MovimentacaoStatus.CONFIRMADO.value,
    )
    session.add(movimentacao)
    session.flush()
    session.add(
        MovimentacaoSpca(
            movimentacao_id=movimentacao.id,
            fonte_recurso="OR",
            natureza_recurso="0",
            tipo_origem_recurso="PF",
            classificacao_receita="300",
            especie_recurso="PIX",
        )
    )
    session.commit()

    assert ensure_doacao_link(session, movimentacao.id) is None


@pytest.mark.skipif(
    not DOACAO_SCHEMA.is_file(),
    reason="doacaoFinanceira.xsd not installed",
)
def test_build_doacao_xml_pf_pix(session: Session, diretorio_sp: DiretorioEstadual):
    _seed_doacao_movimentacao(session, diretorio_sp)

    output_path = build_doacao_xml(session, uf="SP", exercicio=2025, cnpj=CNPJ_PRESTADOR)

    assert output_path.is_file()
    xml_text = output_path.read_text(encoding="utf-8")
    assert "spcaImportacaoArquivo" in xml_text
    assert "12345678909" in xml_text
    assert NR_RECIBO in xml_text
    assert "500.00" in xml_text
    assert "doadoresOriginarios" in xml_text

    errors = validate_xml(output_path, schema_name="doacao")
    assert errors == []


def test_build_doacao_xml_skips_unsynchronized_link(session: Session, diretorio_sp: DiretorioEstadual):
    movimentacao = _seed_doacao_movimentacao(session, diretorio_sp, sincronizado_via_link=False)
    link = ensure_doacao_link(session, movimentacao.id)
    assert link is not None
    link.sincronizado = False
    session.commit()

    output_path = build_doacao_xml(session, uf="SP", exercicio=2025, cnpj=CNPJ_PRESTADOR)
    xml_text = output_path.read_text(encoding="utf-8")
    assert "<totalDoacao>0</totalDoacao>" in xml_text.replace(" ", "")
