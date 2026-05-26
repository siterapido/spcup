"""OFX bank statement parsing and persistence."""

from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from ofxparse import OfxParser
from sqlalchemy.orm import Session

from spc_up.models.entities import Movimentacao, MovimentacaoDirecao, MovimentacaoStatus


def _to_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return value.date()


def _transaction_direction(amount: Decimal) -> tuple[str, Decimal]:
    if amount >= 0:
        return MovimentacaoDirecao.ENTRADA.value, abs(amount)
    return MovimentacaoDirecao.SAIDA.value, abs(amount)


def parse_ofx(path: str | Path) -> list[dict[str, Any]]:
    """Parse an OFX file into normalized transaction rows."""
    with Path(path).open("rb") as handle:
        ofx = OfxParser.parse(handle)

    rows: list[dict[str, Any]] = []
    for account in ofx.accounts:
        statement = account.statement
        if statement is None:
            continue
        for transaction in statement.transactions:
            amount = Decimal(str(transaction.amount))
            direcao, valor = _transaction_direction(amount)
            description = (transaction.payee or transaction.memo or "").strip()
            rows.append(
                {
                    "data_movimento": _to_date(transaction.date),
                    "valor": valor,
                    "descricao_raw": description,
                    "direcao": direcao,
                    "nr_extrato_bancario": transaction.id or None,
                }
            )
    return rows


def compute_hash_movimento(uf: str, exercicio: int, row: dict[str, Any]) -> str:
    """Build a deduplication hash for a parsed transaction row."""
    payload = "|".join(
        [
            uf,
            str(exercicio),
            row["data_movimento"].isoformat(),
            f"{row['valor']:.2f}",
            row["descricao_raw"],
            row["direcao"],
            row.get("nr_extrato_bancario") or "",
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def persist_transactions(
    session: Session,
    uf: str,
    exercicio: int,
    arquivo_ingestao_id: UUID,
    rows: list[dict[str, Any]],
) -> list[Movimentacao]:
    """Persist parsed rows as draft movimentacoes with deduplication hashes."""
    created: list[Movimentacao] = []
    for row in rows:
        movimentacao = Movimentacao(
            uf=uf,
            exercicio=exercicio,
            data_movimento=row["data_movimento"],
            valor=row["valor"],
            descricao_raw=row["descricao_raw"],
            direcao=row["direcao"],
            nr_extrato_bancario=row.get("nr_extrato_bancario"),
            arquivo_ingestao_id=arquivo_ingestao_id,
            status=MovimentacaoStatus.RASCUNHO.value,
            hash_movimento=compute_hash_movimento(uf, exercicio, row),
        )
        session.add(movimentacao)
        created.append(movimentacao)
    session.commit()
    return created
