"""Tests for OpenRouter PDF extraction and ingestion."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from spc_up.models.entities import (
    ArquivoIngestao,
    ArquivoIngestaoStatus,
    DiretorioEstadual,
    MovimentacaoStatus,
    PessoaFisica,
)
from spc_up.services.ai.openrouter import extract_structured_from_pdf
from spc_up.services.ingest.pdf import ingest_pdf

SAMPLE_EXTRACTION = {
    "cpf": "12345678909",
    "nome": "Joao Silva",
    "valor": 1000.0,
    "data": "2025-03-15",
    "direcao": "ENTRADA",
}


def _mock_openrouter_response(payload: dict) -> httpx.Response:
    body = {
        "choices": [
            {
                "message": {
                    "content": json.dumps(payload),
                }
            }
        ]
    }
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    return httpx.Response(status_code=200, json=body, request=request)


def test_extract_structured_from_pdf_returns_expected_fields(tmp_path: Path):
    pdf_path = tmp_path / "comprovante.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

    mock_client = MagicMock(spec=httpx.Client)
    mock_client.post.return_value = _mock_openrouter_response(SAMPLE_EXTRACTION)

    with patch("spc_up.services.ai.openrouter.settings.openrouter_api_key", "test-key"):
        result = extract_structured_from_pdf(pdf_path, client=mock_client)

    assert result == SAMPLE_EXTRACTION
    mock_client.post.assert_called_once()
    call_kwargs = mock_client.post.call_args.kwargs
    assert call_kwargs["json"]["response_format"]["type"] == "json_schema"


def test_extract_structured_from_pdf_retries_on_http_error(tmp_path: Path):
    pdf_path = tmp_path / "comprovante.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

    mock_client = MagicMock(spec=httpx.Client)
    mock_client.post.side_effect = [
        httpx.HTTPStatusError(
            "server error",
            request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions"),
            response=httpx.Response(status_code=503, request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")),
        ),
        _mock_openrouter_response(SAMPLE_EXTRACTION),
    ]

    with (
        patch("spc_up.services.ai.openrouter.settings.openrouter_api_key", "test-key"),
        patch("spc_up.services.ai.openrouter.time.sleep"),
    ):
        result = extract_structured_from_pdf(pdf_path, client=mock_client)

    assert result == SAMPLE_EXTRACTION
    assert mock_client.post.call_count == 2


def test_ingest_pdf_persists_and_applies_match(session, tmp_path: Path):
    pdf_path = tmp_path / "comprovante.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

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
        nome_arquivo="comprovante.pdf",
        hash_arquivo="abc123",
        caminho_storage=str(pdf_path),
        status=ArquivoIngestaoStatus.PENDENTE.value,
    )
    session.add(arquivo)
    session.commit()

    with patch(
        "spc_up.services.ingest.pdf.extract_structured_from_pdf",
        return_value=SAMPLE_EXTRACTION,
    ):
        movimentacoes = ingest_pdf(session, "SP", 2025, arquivo.id, pdf_path)

    assert len(movimentacoes) == 1
    movimentacao = movimentacoes[0]
    assert movimentacao.data_movimento == date(2025, 3, 15)
    assert movimentacao.valor == Decimal("1000.0")
    assert movimentacao.direcao == "ENTRADA"
    assert "12345678909" in movimentacao.descricao_raw
    assert movimentacao.arquivo_ingestao_id == arquivo.id
    assert movimentacao.status == MovimentacaoStatus.PENDENTE_REVISAO.value
    assert movimentacao.pessoa_fisica_id is not None

    pessoa = session.get(PessoaFisica, movimentacao.pessoa_fisica_id)
    assert pessoa is not None
    assert pessoa.cpf == "12345678909"


def test_extract_structured_from_pdf_requires_api_key(tmp_path: Path):
    pdf_path = tmp_path / "comprovante.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 sample")

    with patch("spc_up.services.ai.openrouter.settings.openrouter_api_key", ""):
        with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
            extract_structured_from_pdf(pdf_path, client=MagicMock(spec=httpx.Client))
