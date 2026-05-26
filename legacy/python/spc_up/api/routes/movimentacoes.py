"""Movimentação list and confirm routes."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from spc_up.api.deps import get_db
from spc_up.models.entities import Movimentacao, MovimentacaoStatus
from spc_up.services.confidence import evaluate_movimentacao
from spc_up.services.export.guard import can_export

router = APIRouter(prefix="/api/movimentacoes", tags=["movimentacoes"])


class MovimentacaoOut(BaseModel):
    id: str
    uf: str
    exercicio: int
    direcao: str
    valor: str
    data_movimento: str
    descricao_raw: str
    status: str
    confianca_global: float
    bloqueio_export: bool
    pessoa_nome: str | None = None


class ConfirmBody(BaseModel):
    ids: list[str]


@router.get("")
def list_movimentacoes(
    uf: str = Query(...),
    exercicio: int = Query(...),
    status: str | None = Query(None),
    min_score: float | None = Query(None),
    session: Session = Depends(get_db),
) -> dict:
    uf = uf.upper()
    stmt = (
        select(Movimentacao)
        .where(Movimentacao.uf == uf, Movimentacao.exercicio == exercicio)
        .options(
            joinedload(Movimentacao.pessoa_fisica),
            joinedload(Movimentacao.pessoa_juridica),
        )
        .order_by(Movimentacao.data_movimento.desc())
    )
    if status:
        stmt = stmt.where(Movimentacao.status == status)
    if min_score is not None:
        stmt = stmt.where(Movimentacao.confianca_global >= min_score)

    rows = session.scalars(stmt).unique().all()
    items: list[MovimentacaoOut] = []
    for m in rows:
        pessoa_nome = None
        if m.pessoa_fisica:
            pessoa_nome = m.pessoa_fisica.nome
        elif m.pessoa_juridica:
            pessoa_nome = m.pessoa_juridica.razao_social
        items.append(
            MovimentacaoOut(
                id=str(m.id),
                uf=m.uf,
                exercicio=m.exercicio,
                direcao=m.direcao.value if hasattr(m.direcao, "value") else str(m.direcao),
                valor=str(m.valor),
                data_movimento=m.data_movimento.isoformat(),
                descricao_raw=m.descricao_raw,
                status=m.status.value if hasattr(m.status, "value") else str(m.status),
                confianca_global=m.confianca_global,
                bloqueio_export=m.bloqueio_export,
                pessoa_nome=pessoa_nome,
            )
        )

    return {
        "uf": uf,
        "exercicio": exercicio,
        "exportavel": can_export(session, uf, exercicio),
        "total": len(items),
        "items": items,
    }


@router.post("/confirm")
def confirm_movimentacoes(
    body: ConfirmBody,
    session: Session = Depends(get_db),
) -> dict:
    confirmed = 0
    errors: list[str] = []
    for raw_id in body.ids:
        try:
            mov_id = uuid.UUID(raw_id)
        except ValueError:
            errors.append(f"UUID inválido: {raw_id}")
            continue
        movimentacao = session.get(Movimentacao, mov_id)
        if movimentacao is None:
            errors.append(f"Não encontrada: {raw_id}")
            continue
        evaluate_movimentacao(movimentacao)
        movimentacao.status = MovimentacaoStatus.CONFIRMADO.value
        confirmed += 1
    return {"confirmadas": confirmed, "erros": errors}
