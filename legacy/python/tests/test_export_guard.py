"""Tests for export guard and pendencias report."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import csv
import pytest
from sqlalchemy.orm import Session

from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    DiretorioEstadual,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
)
from spc_up.services.export.guard import can_export
from spc_up.services.report.pendencias import generate_pendencias_csv


@pytest.fixture
def diretorio_sp(session: Session) -> DiretorioEstadual:
    diretorio = DiretorioEstadual(
        uf="SP",
        cnpj_prestador="12345678000199",
        nome="Diretorio SP",
    )
    session.add(diretorio)
    session.commit()
    return diretorio


def _add_movimentacao(
    session: Session,
    *,
    status: str = MovimentacaoStatus.RASCUNHO.value,
    bloqueio_export: bool = False,
    with_spca: bool = False,
    diretorio: DiretorioEstadual | None = None,
) -> Movimentacao:
    arquivo = None
    if diretorio is not None:
        arquivo = ArquivoIngestao(
            diretorio_estadual_id=diretorio.id,
            uf="SP",
            exercicio=2025,
            nome_arquivo="sample.ofx",
            hash_arquivo="hash123",
            caminho_storage="/tmp/sample.ofx",
            status=ArquivoIngestaoStatus.CONCLUIDO.value,
        )
        session.add(arquivo)
        session.flush()

    movimentacao = Movimentacao(
        uf="SP",
        exercicio=2025,
        direcao=MovimentacaoDirecao.ENTRADA.value,
        valor=Decimal("500.00"),
        data_movimento=date(2025, 4, 10),
        descricao_raw="Doacao pendente",
        hash_movimento="movhash001",
        status=status,
        bloqueio_export=bloqueio_export,
        arquivo_ingestao_id=arquivo.id if arquivo is not None else None,
    )
    session.add(movimentacao)
    session.flush()

    if with_spca:
        session.add(
            MovimentacaoSpca(
                movimentacao_id=movimentacao.id,
                fonte_recurso="FP",
                natureza_recurso="0",
                tipo_origem_recurso="PF",
            )
        )

    session.commit()
    session.refresh(movimentacao)
    return movimentacao


def test_export_blocked_when_pending(session: Session):
    _add_movimentacao(session, status=MovimentacaoStatus.PENDENTE_REVISAO.value)

    assert can_export(session, uf="SP", exercicio=2025) is False


def test_can_export_when_all_confirmed(session: Session):
    _add_movimentacao(
        session,
        status=MovimentacaoStatus.CONFIRMADO.value,
        with_spca=True,
    )

    assert can_export(session, uf="SP", exercicio=2025) is True


def test_can_export_blocked_by_bloqueio_flag(session: Session):
    _add_movimentacao(
        session,
        status=MovimentacaoStatus.CONFIRMADO.value,
        bloqueio_export=True,
    )

    assert can_export(session, uf="SP", exercicio=2025) is False


def test_generate_pendencias_csv(
    session: Session,
    diretorio_sp: DiretorioEstadual,
    tmp_path: Path,
):
    _add_movimentacao(
        session,
        status=MovimentacaoStatus.PENDENTE_REVISAO.value,
        bloqueio_export=True,
        diretorio=diretorio_sp,
    )

    output_path = tmp_path / "pendencias.csv"
    row_count = generate_pendencias_csv(session, "SP", 2025, output_path)

    assert row_count == 1
    with output_path.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    assert len(rows) == 1
    assert rows[0]["data"] == "2025-04-10"
    assert rows[0]["valor"] == "500.00"
    assert rows[0]["descricao"] == "Doacao pendente"
    assert "status=PENDENTE_REVISAO" in rows[0]["motivo"]
    assert rows[0]["campos_xsd_faltantes"] == "fonte_recurso,natureza_recurso,tipo_origem_recurso"
    assert rows[0]["arquivo_origem"] == "sample.ofx"
