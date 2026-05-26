"""Create and synchronize DoacaoFinanceiraLink records for doacao entradas."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from spc_up.models.entities import (
    DoacaoFinanceiraLink,
    Movimentacao,
    MovimentacaoDirecao,
    MovimentacaoSpca,
    MovimentacaoStatus,
)

DOACAO_CODES = frozenset({"314", "315", "397"})


def _is_ready_for_sync(movimentacao: Movimentacao) -> bool:
    spca = movimentacao.spca
    if spca is None:
        return False

    return (
        movimentacao.direcao == MovimentacaoDirecao.ENTRADA.value
        and movimentacao.status == MovimentacaoStatus.CONFIRMADO.value
        and movimentacao.pessoa_fisica is not None
        and spca.nr_recibo_doacao is not None
        and spca.nr_recibo_doacao.strip() != ""
    )


def ensure_doacao_link(session: Session, movimentacao_id: uuid.UUID) -> DoacaoFinanceiraLink | None:
    """Ensure a doacao link exists when classificacao_receita is a doacao code."""
    movimentacao = session.execute(
        select(Movimentacao)
        .join(MovimentacaoSpca, MovimentacaoSpca.movimentacao_id == Movimentacao.id)
        .options(
            selectinload(Movimentacao.spca),
            selectinload(Movimentacao.pessoa_fisica),
            selectinload(Movimentacao.doacao_link),
        )
        .where(Movimentacao.id == movimentacao_id)
    ).scalar_one_or_none()

    if movimentacao is None or movimentacao.spca is None:
        return None

    classificacao = (movimentacao.spca.classificacao_receita or "").strip()
    if classificacao not in DOACAO_CODES:
        return None

    link = movimentacao.doacao_link
    if link is None:
        link = DoacaoFinanceiraLink(movimentacao_origem_id=movimentacao.id)
        session.add(link)

    link.sincronizado = _is_ready_for_sync(movimentacao)
    session.commit()
    session.refresh(link)
    return link
