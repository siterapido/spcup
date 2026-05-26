"""Confirm movimentacoes after human review."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from spc_up.models.entities import Movimentacao, MovimentacaoStatus
from spc_up.services.confidence import evaluate_movimentacao


def confirm_movimentacoes(session: Session, ids: list[UUID]) -> list[UUID]:
    """Mark movimentacoes as CONFIRMADO after re-evaluating confidence."""
    if not ids:
        return []

    movimentacoes = session.execute(
        select(Movimentacao)
        .options(selectinload(Movimentacao.evidencias), selectinload(Movimentacao.spca))
        .where(Movimentacao.id.in_(ids))
    ).scalars().all()

    found_ids = {movimentacao.id for movimentacao in movimentacoes}
    missing = [mov_id for mov_id in ids if mov_id not in found_ids]
    if missing:
        raise ValueError(f"Movimentacoes not found: {', '.join(str(m) for m in missing)}")

    confirmed: list[UUID] = []
    for movimentacao in movimentacoes:
        evaluate_movimentacao(movimentacao)
        movimentacao.status = MovimentacaoStatus.CONFIRMADO.value
        confirmed.append(movimentacao.id)

    return confirmed
