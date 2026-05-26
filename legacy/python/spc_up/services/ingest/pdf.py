"""PDF bank statement ingestion via OpenRouter."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from spc_up.models.entities import Movimentacao
from spc_up.services.ai.openrouter import extract_structured_from_pdf
from spc_up.services.ingest.ofx import compute_hash_movimento, persist_transactions
from spc_up.services.match.rules import apply_deterministic_match


def _parse_extraction_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def _row_from_extraction(extracted: dict[str, Any]) -> dict[str, Any]:
    cpf = str(extracted["cpf"]).strip()
    nome = str(extracted["nome"]).strip()
    valor = Decimal(str(extracted["valor"]))
    direcao = str(extracted["direcao"]).strip().upper()
    if direcao not in {"ENTRADA", "SAIDA"}:
        raise ValueError(f"Direcao invalida: {direcao!r}")

    return {
        "data_movimento": _parse_extraction_date(str(extracted["data"])),
        "valor": abs(valor),
        "descricao_raw": f"{nome} CPF {cpf}",
        "direcao": direcao,
        "nr_extrato_bancario": None,
    }


def ingest_pdf(
    session: Session,
    uf: str,
    exercicio: int,
    arquivo_id: UUID,
    path: str | Path,
) -> list[Movimentacao]:
    """Extract PDF data with OpenRouter, persist movimentacao, and run match rules."""
    extracted = extract_structured_from_pdf(path)
    row = _row_from_extraction(extracted)
    created = persist_transactions(session, uf, exercicio, arquivo_id, [row])

    matched: list[Movimentacao] = []
    for movimentacao in created:
        matched.append(apply_deterministic_match(session, movimentacao.id))
    return matched
