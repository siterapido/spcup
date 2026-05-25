"""Tests for OFX ingestion."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    DiretorioEstadual,
    MovimentacaoStatus,
)
from spc_up.services.ingest.ofx import compute_hash_movimento, parse_ofx, persist_transactions

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "sample.ofx"


def test_parse_ofx_directions():
    rows = parse_ofx(FIXTURE_PATH)
    assert any(r["direcao"] == "ENTRADA" for r in rows)
    assert any(r["direcao"] == "SAIDA" for r in rows)


def test_parse_ofx_returns_expected_fields():
    rows = parse_ofx(FIXTURE_PATH)
    assert len(rows) == 2
    for row in rows:
        assert set(row.keys()) >= {
            "data_movimento",
            "valor",
            "descricao_raw",
            "direcao",
            "nr_extrato_bancario",
        }
        assert isinstance(row["valor"], Decimal)
        assert row["direcao"] in {"ENTRADA", "SAIDA"}


def test_compute_hash_movimento_is_sha256():
    row = {
        "data_movimento": parse_ofx(FIXTURE_PATH)[0]["data_movimento"],
        "valor": Decimal("1000.00"),
        "descricao_raw": "Recebimento doacao",
        "direcao": "ENTRADA",
        "nr_extrato_bancario": "CREDIT001",
    }
    digest = compute_hash_movimento("SP", 2025, row)
    assert len(digest) == 64
    assert digest == compute_hash_movimento("SP", 2025, row)


def test_persist_transactions_creates_rascunho(session):
    diretorio = DiretorioEstadual(
        uf="SP",
        cnpj_prestador="12345678000199",
        nome="Diretorio SP",
    )
    session.add(diretorio)
    session.flush()

    arquivo = ArquivoIngestao(
        diretorio_estadual_id=diretorio.id,
        uf="SP",
        exercicio=2025,
        nome_arquivo="sample.ofx",
        hash_arquivo="abc123",
        caminho_storage="/tmp/sample.ofx",
        status=ArquivoIngestaoStatus.PENDENTE.value,
    )
    session.add(arquivo)
    session.commit()

    rows = parse_ofx(FIXTURE_PATH)
    created = persist_transactions(session, "SP", 2025, arquivo.id, rows)

    assert len(created) == 2
    for movimentacao in created:
        assert movimentacao.status == MovimentacaoStatus.RASCUNHO.value
        assert movimentacao.arquivo_ingestao_id == arquivo.id
        assert len(movimentacao.hash_movimento) == 64
