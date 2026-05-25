"""Tests for deterministic transaction matching."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from spc_up.models.entities import (
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoStatus,
    PessoaFisica,
)
from spc_up.services.match.rules import apply_deterministic_match


@pytest.fixture
def sample_movimentacao(session: Session) -> Movimentacao:
    movimentacao = Movimentacao(
        uf="SP",
        exercicio=2025,
        direcao=MovimentacaoDirecao.ENTRADA.value,
        valor=Decimal("1000.00"),
        data_movimento=date(2025, 3, 15),
        descricao_raw="Doacao recebida CPF 123.456.789-09",
        hash_movimento="abc123def456",
        status=MovimentacaoStatus.RASCUNHO.value,
    )
    session.add(movimentacao)
    session.commit()
    session.refresh(movimentacao)
    return movimentacao


def test_match_cpf_in_description(session: Session, sample_movimentacao: Movimentacao):
    apply_deterministic_match(session, sample_movimentacao.id)

    movimentacao = session.get(Movimentacao, sample_movimentacao.id)
    assert movimentacao is not None
    assert movimentacao.confianca_global >= 0.45
    assert movimentacao.pessoa_fisica_id is not None
    assert movimentacao.status == MovimentacaoStatus.PENDENTE_REVISAO.value
    assert len(movimentacao.evidencias) == 1
    assert movimentacao.evidencias[0].tipo == "CPF_EXATO"
    assert movimentacao.bloqueio_export is True

    pessoa = session.get(PessoaFisica, movimentacao.pessoa_fisica_id)
    assert pessoa is not None
    assert pessoa.cpf == "12345678909"


def test_match_links_existing_pessoa(session: Session, sample_movimentacao: Movimentacao):
    existing = PessoaFisica(cpf="12345678909", nome="Joao Silva")
    session.add(existing)
    session.commit()

    apply_deterministic_match(session, sample_movimentacao.id)

    movimentacao = session.get(Movimentacao, sample_movimentacao.id)
    assert movimentacao is not None
    assert movimentacao.pessoa_fisica_id == existing.id
