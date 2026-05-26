"""Export guard — block export when pendencies exist for a UF/exercicio."""

from __future__ import annotations

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from spc_up.models.entities import Movimentacao, MovimentacaoStatus

_EXPORTABLE_STATUSES = (
    MovimentacaoStatus.CONFIRMADO.value,
    MovimentacaoStatus.EXPORTADO.value,
)


def can_export(session: Session, uf: str, exercicio: int) -> bool:
    """Return True when every movimentacao for the scope is export-ready."""
    blocking = session.execute(
        select(Movimentacao.id)
        .where(
            Movimentacao.uf == uf,
            Movimentacao.exercicio == exercicio,
            or_(
                Movimentacao.status.not_in(_EXPORTABLE_STATUSES),
                Movimentacao.bloqueio_export.is_(True),
            ),
        )
        .limit(1)
    ).first()
    return blocking is None
